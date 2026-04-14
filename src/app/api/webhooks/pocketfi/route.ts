import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERADMIN_EMAIL = "growthprofesors@gmail.com";

type PocketFiPayload = {
  event?: string;
  data?: {
    reference?: string;
    amount?: number | string;
    status?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const signature = signatureHeader.trim().toLowerCase();
  if (!signature || !secret) return false;
  const digest = createHmac("sha512", secret).update(rawBody).digest("hex").toLowerCase();
  if (digest.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

function extractSignature(req: Request): string {
  return (
    req.headers.get("x-pocketfi-signature") ??
    req.headers.get("pocketfi-signature") ??
    req.headers.get("x-signature") ??
    ""
  );
}

function getAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function canUseAdminBypass(req: Request): Promise<boolean> {
  const bypassRequested = normalize(req.headers.get("x-admin-bypass")) === "true";
  if (!bypassRequested) return false;

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return false;

  return normalize(data.user.email) === SUPERADMIN_EMAIL;
}

async function fulfillPurchaseFromReference(
  supabaseAdmin: SupabaseClient,
  reference: string,
  amountRaw: unknown,
) {
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference")
    .eq("reference", reference)
    .eq("type", "purchase")
    .maybeSingle();

  if (txError) {
    return { ok: false, status: 500, error: `Failed to fetch transaction: ${txError.message}` };
  }
  if (!tx) {
    return { ok: true, status: 200, data: { ok: true, message: "No purchase row matched this reference." } };
  }
  if (tx.status === "completed" || tx.status === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = asPositiveInt(amountRaw, asPositiveInt(tx.amount, 0));
  if (!tx.product_id) {
    return { ok: false, status: 400, error: "Transaction has no product_id." };
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, stock, status, manual_stock")
    .eq("id", tx.product_id)
    .maybeSingle();
  if (productError || !product) {
    return {
      ok: false,
      status: 500,
      error: `Failed to fetch product for fulfillment: ${productError?.message ?? "not found"}`,
    };
  }

  const { count: availableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError) {
    return { ok: false, status: 500, error: `Failed to count available logs: ${countError.message}` };
  }

  const { data: availableLogs, error: logFetchError } = await supabaseAdmin
    .from("log_items")
    .select("id, credentials")
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false)
    .order("created_at", { ascending: true })
    .limit(quantity);
  if (logFetchError) {
    return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${logFetchError.message}` };
  }

  const logsToDeliver = availableLogs ?? [];
  const fromLogs = Math.min(logsToDeliver.length, quantity);
  const fromManual = quantity - fromLogs;
  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));

  if (fromManual > manualStock) {
    return {
      ok: false,
      status: 409,
      error: `Insufficient stock. needed_manual=${fromManual}, manual_stock=${manualStock}`,
    };
  }

  if (fromLogs > 0) {
    const logIds = logsToDeliver.slice(0, fromLogs).map((row) => row.id);
    const { error: markDeliveredError } = await supabaseAdmin
      .from("log_items")
      .update({ is_delivered: true, status: "delivered" })
      .in("id", logIds);
    if (markDeliveredError) {
      return {
        ok: false,
        status: 500,
        error: `Failed to mark delivered logs: ${markDeliveredError.message}`,
      };
    }
  }

  const newManualStock = manualStock - fromManual;
  const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
  const newStock = Math.max(0, currentStock - quantity);
  const remainingLogs = Math.max(0, (availableLogCount ?? 0) - fromLogs);
  const remainingTotal = remainingLogs + newManualStock;
  const nextProductStatus = remainingTotal > 0 ? "available" : "sold_out";

  const { error: updateProductError } = await supabaseAdmin
    .from("products")
    .update({
      manual_stock: newManualStock,
      stock: newStock,
      status: nextProductStatus,
    })
    .eq("id", tx.product_id);
  if (updateProductError) {
    return { ok: false, status: 500, error: `Failed to update product inventory: ${updateProductError.message}` };
  }

  const deliveredCredentials = logsToDeliver.slice(0, fromLogs).map((row) => row.credentials);
  const { error: txUpdateError } = await supabaseAdmin
    .from("transactions")
    .update({
      status: "completed",
      amount: amountNaira > 0 ? amountNaira : tx.amount,
      credentials_delivered: deliveredCredentials,
      log_id: fromLogs > 0 ? logsToDeliver[fromLogs - 1].id : null,
    })
    .eq("id", tx.id);
  if (txUpdateError) {
    return {
      ok: false,
      status: 500,
      error: `Failed to mark transaction completed: ${txUpdateError.message}`,
    };
  }

  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", tx.user_id)
    .maybeSingle();

  if (fromLogs > 0) {
    console.log("[PocketFiWebhook] Fulfillment credentials prepared for customer email", {
      reference,
      email: profileRow?.email ?? null,
      delivered_count: fromLogs,
      credentials_preview: deliveredCredentials,
    });
  } else {
    console.log("[PocketFiWebhook] Fulfillment from manual stock completed", {
      reference,
      email: profileRow?.email ?? null,
      quantity,
      manual_stock_after: newManualStock,
    });
  }

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      processed: true,
      reference,
      delivered_logs: fromLogs,
      manual_units_used: fromManual,
    },
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = extractSignature(req);
  const secret = (process.env.POCKETFI_SECRET_KEY ?? "").trim();
  if (!secret) {
    console.error("[PocketFiWebhook] Missing POCKETFI_SECRET_KEY");
    return json({ error: "Server misconfigured: missing PocketFi secret." }, 500);
  }

  const hasValidSignature = verifySignature(rawBody, signature, secret);
  const bypassAllowed = await canUseAdminBypass(req);
  if (!hasValidSignature && !bypassAllowed) {
    console.error("[PocketFiWebhook] Invalid signature", {
      signature_present: Boolean(signature),
      body_preview: rawBody.slice(0, 250),
    });
    return json({ error: "Invalid signature." }, 401);
  }

  let payload: PocketFiPayload;
  try {
    payload = JSON.parse(rawBody) as PocketFiPayload;
  } catch (error) {
    console.error("[PocketFiWebhook] Invalid JSON payload", { error });
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const event = normalize(payload.event);
  if (event !== "payment.success") {
    return json({ ok: true, ignored: true, event });
  }

  const reference = String(payload.data?.reference ?? "").trim();
  if (!reference) {
    return json({ error: "Missing transaction reference." }, 400);
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
  } catch (error) {
    console.error("[PocketFiWebhook] Supabase admin client setup failed", { error });
    return json({ error: "Server misconfigured for fulfillment." }, 500);
  }

  const fulfilled = await fulfillPurchaseFromReference(supabaseAdmin, reference, payload.data?.amount);
  if (!fulfilled.ok) {
    console.error("[PocketFiWebhook] Fulfillment failed", {
      reference,
      error: fulfilled.error,
      payload: safeStringify(payload),
    });
    return json({ error: fulfilled.error ?? "Fulfillment failed." }, fulfilled.status);
  }

  console.log("[PocketFiWebhook] payment.success processed", {
    reference,
    bypass: bypassAllowed,
    verified: hasValidSignature,
  });
  return json(fulfilled.data ?? { ok: true }, fulfilled.status);
}
