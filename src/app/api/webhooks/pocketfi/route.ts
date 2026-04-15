import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERADMIN_EMAILS = new Set([
  "growthprofesors@gmail.com",
  "godwindavid199501@gmail.com",
]);

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
type EnvCheck = {
  url: string | null;
  serviceRoleKey: string | null;
  missing: string[];
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function isWhitelistedAdminEmail(email: string | null | undefined): boolean {
  return SUPERADMIN_EMAILS.has(normalize(email));
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function formatDbError(error: {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
} | null | undefined): string {
  if (!error) return "Unknown database error.";
  const parts = [
    error.message ? `message=${error.message}` : "",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean);
  return parts.join(" | ") || "Unknown database error.";
}

function extractDeliveredData(payload: Record<string, unknown>): string[] {
  const raw = payload.delivered_data ?? payload.credentials_delivered;
  if (typeof raw === "string") {
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function toEmailPassword(credentials: string): string {
  const clean = String(credentials ?? "").trim();
  if (!clean) return "";
  const parts = clean.includes("|") ? clean.split("|") : clean.split(":");
  if (parts.length < 2) return clean;
  return `${String(parts[0] ?? "").trim()}:${String(parts[1] ?? "").trim()}`;
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

function resolveServiceEnv(): EnvCheck {
  const urlFromNextPublic = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const urlFromServer = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const missing: string[] = [];
  const url = urlFromNextPublic || urlFromServer || null;

  if (!urlFromNextPublic && !urlFromServer) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  return { url, serviceRoleKey: serviceRoleKey || null, missing };
}

function getAdminClient(): SupabaseClient {
  const env = resolveServiceEnv();
  if (!env.url || !env.serviceRoleKey) {
    throw new Error(`Missing required env: ${env.missing.join(", ")}`);
  }
  return createClient(env.url, env.serviceRoleKey, {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return false;

  return isWhitelistedAdminEmail(data.user.email);
}

async function fulfillPurchaseFromReference(
  supabaseAdmin: SupabaseClient,
  reference: string,
  amountRaw: unknown,
) {
  // This path always runs with service-role client (bypasses RLS for admin simulation).
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference")
    .eq("reference", reference)
    .eq("type", "purchase")
    .maybeSingle();

  if (txError) {
    return { ok: false, status: 500, error: `Failed to fetch transaction: ${formatDbError(txError)}` };
  }
  if (!tx) {
    return { ok: true, status: 200, data: { ok: true, message: "No purchase row matched this reference." } };
  }
  if (tx.status === "completed" || tx.status === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }
  const { data: buyerProfile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", tx.user_id)
    .maybeSingle();
  const isAdminBuyer = isWhitelistedAdminEmail(buyerProfile?.email);

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
      error: `Failed to fetch product for fulfillment: ${formatDbError(productError)}`,
    };
  }
  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));
  const canSatisfyFromManualOnly = manualStock >= quantity;

  const { count: rawAvailableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError && !canSatisfyFromManualOnly) {
    return { ok: false, status: 500, error: `Failed to count available logs: ${formatDbError(countError)}` };
  }
  if (countError && canSatisfyFromManualOnly) {
    console.warn("[PocketFiWebhook] Counting logs failed; using manual stock fallback.", {
      reference,
      product_id: tx.product_id,
      count_error: formatDbError(countError),
      manual_stock: manualStock,
      quantity,
    });
  }
  const availableLogCount = countError ? 0 : Math.max(0, Number(rawAvailableLogCount ?? 0));

  let logsToDeliver: Array<{ id: string; credentials: string }> = [];
  if (availableLogCount > 0) {
    const { data: availableLogs, error: logFetchError } = await supabaseAdmin
      .from("log_items")
      .select("id, credentials")
      .eq("product_id", tx.product_id)
      .eq("status", "available")
      .eq("is_delivered", false)
      .order("created_at", { ascending: true })
      .limit(quantity);
    if (logFetchError && !canSatisfyFromManualOnly) {
      return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${formatDbError(logFetchError)}` };
    }
    if (logFetchError && canSatisfyFromManualOnly) {
      console.warn("[PocketFiWebhook] Fetching logs failed; using manual stock fallback.", {
        reference,
        product_id: tx.product_id,
        fetch_error: formatDbError(logFetchError),
        manual_stock: manualStock,
        quantity,
      });
    } else {
      logsToDeliver = (availableLogs ?? []) as Array<{ id: string; credentials: string }>;
    }
  }

  const fromLogs = Math.min(logsToDeliver.length, quantity);
  const fromManual = quantity - fromLogs;

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
        error: `Failed to mark delivered logs: ${formatDbError(markDeliveredError)}`,
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
    return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(updateProductError)}` };
  }

  const deliveredCredentials = logsToDeliver.slice(0, fromLogs).map((row) => row.credentials);
  const deliveredDataLines = deliveredCredentials.map(toEmailPassword).filter(Boolean);
  const deliveredData = deliveredDataLines.join("\n");
  const sharedTxUpdate = {
    status: "completed",
    amount: amountNaira > 0 ? amountNaira : tx.amount,
  };

  // Probe table columns before update to avoid stale assumptions after migrations.
  const txProbe = await supabaseAdmin.from("transactions").select("*").limit(1);
  if (txProbe.error) {
    console.warn("[PocketFiWebhook] transactions schema probe failed", {
      reference,
      error: formatDbError(txProbe.error),
    });
  }

  const primaryTxUpdate = await supabaseAdmin
    .from("transactions")
    .update({
      ...sharedTxUpdate,
      credentials_delivered: true,
      delivered_data: deliveredData,
    })
    .eq("id", tx.id)
    .select("credentials_delivered, delivered_data, log_id")
    .maybeSingle();

  let txUpdateError = primaryTxUpdate.error;
  let resolvedDeliveredData = extractDeliveredData((primaryTxUpdate.data ?? {}) as Record<string, unknown>);

  if (txUpdateError) {
    console.warn("[PocketFiWebhook] Primary transaction update failed; falling back to legacy payload", {
      reference,
      error: formatDbError(txUpdateError),
    });
    const legacyTxUpdate = await supabaseAdmin
      .from("transactions")
      .update({
        ...sharedTxUpdate,
        credentials_delivered: true,
        delivered_data: deliveredData,
      })
      .eq("id", tx.id)
      .select("credentials_delivered, delivered_data, log_id")
      .maybeSingle();
    txUpdateError = legacyTxUpdate.error;
    resolvedDeliveredData = extractDeliveredData((legacyTxUpdate.data ?? {}) as Record<string, unknown>);
  }

  if (txUpdateError) {
    return {
      ok: false,
      status: 500,
      error: `Failed to mark transaction completed: ${formatDbError(txUpdateError)}`,
    };
  }

  if (resolvedDeliveredData.length === 0) {
    resolvedDeliveredData = deliveredDataLines.length > 0 ? deliveredDataLines : deliveredCredentials;
  }

  if (fromLogs > 0) {
    const logId = logsToDeliver[fromLogs - 1].id;
    const logIdUpdate = await supabaseAdmin
      .from("transactions")
      .update({ log_id: logId })
      .eq("id", tx.id);
    if (logIdUpdate.error) {
      // Non-fatal by requirement: log_id write failure should not fail fulfillment.
      console.warn("[PocketFiWebhook] Non-fatal: failed to update transactions.log_id", {
        reference,
        transaction_id: tx.id,
        log_id: logId,
        error: formatDbError(logIdUpdate.error),
      });
    }
  }

  const profileRow = buyerProfile;

  if (fromLogs > 0) {
    console.log("[PocketFiWebhook] Fulfillment credentials prepared for customer email", {
      reference,
      email: profileRow?.email ?? null,
      admin_buyer: isAdminBuyer,
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
      delivered_data: resolvedDeliveredData,
    },
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = extractSignature(req);
  const bypassAllowed = await canUseAdminBypass(req);
  const secret = (process.env.POCKETFI_SECRET_KEY ?? "").trim();
  if (!secret && !bypassAllowed) {
    console.error("[PocketFiWebhook] Missing POCKETFI_SECRET_KEY");
    return json({ error: "Server misconfigured: missing PocketFi secret." }, 500);
  }

  const hasValidSignature = secret ? verifySignature(rawBody, signature, secret) : false;
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
    const env = resolveServiceEnv();
    console.error("[PocketFiWebhook] Supabase admin client setup failed", {
      error,
      missing_env: env.missing,
      has_next_public_supabase_url: Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()),
      has_supabase_url: Boolean((process.env.SUPABASE_URL ?? "").trim()),
      has_service_role_key: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()),
    });
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
