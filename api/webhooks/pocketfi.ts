import { createHmac, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = {
  method?: string;
  headers: ApiHeaders;
  body?: unknown;
};
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function extractSignature(req: ApiRequest): string {
  return headerValue(req.headers, "x-pocketfi-signature")
    || headerValue(req.headers, "pocketfi-signature")
    || headerValue(req.headers, "x-signature")
    || "";
}

function getAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function canUseAdminBypass(req: ApiRequest): Promise<boolean> {
  const bypassRequested = normalize(headerValue(req.headers, "x-admin-bypass")) === "true";
  if (!bypassRequested) return false;
  const authHeader = headerValue(req.headers, "authorization");
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

  if (txError) return { ok: false, status: 500, error: `Failed to fetch transaction: ${txError.message}` };
  if (!tx) return { ok: true, status: 200, data: { ok: true, message: "No purchase row matched this reference." } };
  if (tx.status === "completed" || tx.status === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = asPositiveInt(amountRaw, asPositiveInt(tx.amount, 0));
  if (!tx.product_id) return { ok: false, status: 400, error: "Transaction has no product_id." };

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, stock, status, manual_stock")
    .eq("id", tx.product_id)
    .maybeSingle();
  if (productError || !product) {
    return { ok: false, status: 500, error: `Failed to fetch product for fulfillment: ${productError?.message ?? "not found"}` };
  }

  const { count: availableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError) return { ok: false, status: 500, error: `Failed to count available logs: ${countError.message}` };

  const { data: availableLogs, error: logFetchError } = await supabaseAdmin
    .from("log_items")
    .select("id, credentials")
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false)
    .order("created_at", { ascending: true })
    .limit(quantity);
  if (logFetchError) return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${logFetchError.message}` };

  const logsToDeliver = availableLogs ?? [];
  const fromLogs = Math.min(logsToDeliver.length, quantity);
  const fromManual = quantity - fromLogs;
  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));
  if (fromManual > manualStock) {
    return { ok: false, status: 409, error: `Insufficient stock. needed_manual=${fromManual}, manual_stock=${manualStock}` };
  }

  if (fromLogs > 0) {
    const logIds = logsToDeliver.slice(0, fromLogs).map((row) => row.id);
    const { error: markDeliveredError } = await supabaseAdmin
      .from("log_items")
      .update({ is_delivered: true, status: "delivered" })
      .in("id", logIds);
    if (markDeliveredError) return { ok: false, status: 500, error: `Failed to mark delivered logs: ${markDeliveredError.message}` };
  }

  const newManualStock = manualStock - fromManual;
  const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
  const newStock = Math.max(0, currentStock - quantity);
  const remainingLogs = Math.max(0, (availableLogCount ?? 0) - fromLogs);
  const remainingTotal = remainingLogs + newManualStock;
  const nextProductStatus = remainingTotal > 0 ? "available" : "sold_out";

  const { error: updateProductError } = await supabaseAdmin
    .from("products")
    .update({ manual_stock: newManualStock, stock: newStock, status: nextProductStatus })
    .eq("id", tx.product_id);
  if (updateProductError) return { ok: false, status: 500, error: `Failed to update product inventory: ${updateProductError.message}` };

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
  if (txUpdateError) return { ok: false, status: 500, error: `Failed to mark transaction completed: ${txUpdateError.message}` };

  const { data: profileRow } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", tx.user_id)
    .maybeSingle();

  if (fromLogs > 0) {
    console.log("[PocketFiWebhook] Logs prepared for customer", {
      reference,
      email: profileRow?.email ?? null,
      delivered_count: fromLogs,
      credentials_preview: deliveredCredentials,
    });
  } else {
    console.log("[PocketFiWebhook] Manual stock decremented for customer", {
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

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-pocketfi-signature, x-admin-bypass");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const rawBody = JSON.stringify(req.body ?? {});
  const bypassAllowed = await canUseAdminBypass(req);
  const secret = (process.env.POCKETFI_SECRET_KEY ?? "").trim();
  if (!secret && !bypassAllowed) {
    console.error("[PocketFiWebhook] Missing POCKETFI_SECRET_KEY");
    res.status(500).json({ error: "Server misconfigured: missing PocketFi secret." });
    return;
  }

  const signature = String(extractSignature(req));
  const hasValidSignature = secret ? verifySignature(rawBody, signature, secret) : false;
  if (!hasValidSignature && !bypassAllowed) {
    console.error("[PocketFiWebhook] Invalid signature", {
      signature_present: Boolean(signature),
      body_preview: rawBody.slice(0, 250),
    });
    res.status(401).json({ error: "Invalid signature." });
    return;
  }

  const payload = (req.body ?? {}) as PocketFiPayload;
  if (normalize(payload.event) !== "payment.success") {
    res.status(200).json({ ok: true, ignored: true, event: payload.event ?? null });
    return;
  }

  const reference = String(payload.data?.reference ?? "").trim();
  if (!reference) {
    res.status(400).json({ error: "Missing transaction reference." });
    return;
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
  } catch (error) {
    console.error("[PocketFiWebhook] Supabase admin client setup failed", { error });
    res.status(500).json({ error: "Server misconfigured for fulfillment." });
    return;
  }

  const fulfilled = await fulfillPurchaseFromReference(supabaseAdmin, reference, payload.data?.amount);
  if (!fulfilled.ok) {
    console.error("[PocketFiWebhook] Fulfillment failed", { reference, error: fulfilled.error });
    res.status(fulfilled.status).json({ error: fulfilled.error ?? "Fulfillment failed." });
    return;
  }

  console.log("[PocketFiWebhook] payment.success processed", {
    reference,
    bypass: bypassAllowed,
    verified: hasValidSignature,
  });
  res.status(fulfilled.status).json(fulfilled.data ?? { ok: true });
}
