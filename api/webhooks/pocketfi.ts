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
type EnvCheck = {
  url: string | null;
  serviceRoleKey: string | null;
  missing: string[];
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
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
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
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
  // This path always runs with service-role client (bypasses RLS for admin simulation).
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference")
    .eq("reference", reference)
    .eq("type", "purchase")
    .maybeSingle();

  if (txError) return { ok: false, status: 500, error: `Failed to fetch transaction: ${formatDbError(txError)}` };
  if (!tx) return { ok: true, status: 200, data: { ok: true, message: "No purchase row matched this reference." } };
  if (tx.status === "completed" || tx.status === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }
  const { data: buyerProfile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", tx.user_id)
    .maybeSingle();
  const isAdminBuyer = normalize(buyerProfile?.email) === SUPERADMIN_EMAIL;

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = asPositiveInt(amountRaw, asPositiveInt(tx.amount, 0));
  if (!tx.product_id) return { ok: false, status: 400, error: "Transaction has no product_id." };

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, stock, status, manual_stock")
    .eq("id", tx.product_id)
    .maybeSingle();
  if (productError || !product) {
    return { ok: false, status: 500, error: `Failed to fetch product for fulfillment: ${formatDbError(productError)}` };
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
    return { ok: false, status: 409, error: `Insufficient stock. needed_manual=${fromManual}, manual_stock=${manualStock}` };
  }

  if (fromLogs > 0) {
    const logIds = logsToDeliver.slice(0, fromLogs).map((row) => row.id);
    const { error: markDeliveredError } = await supabaseAdmin
      .from("log_items")
      .update({ is_delivered: true, status: "delivered" })
      .in("id", logIds);
    if (markDeliveredError) return { ok: false, status: 500, error: `Failed to mark delivered logs: ${formatDbError(markDeliveredError)}` };
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
  if (updateProductError) return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(updateProductError)}` };

  const deliveredCredentials = logsToDeliver.slice(0, fromLogs).map((row) => row.credentials);
  const sharedTxUpdate = {
    status: "completed",
    amount: amountNaira > 0 ? amountNaira : tx.amount,
    log_id: fromLogs > 0 ? logsToDeliver[fromLogs - 1].id : null,
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
      delivered_data: deliveredCredentials,
    })
    .eq("id", tx.id)
    .select("credentials_delivered, delivered_data")
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
        credentials_delivered: deliveredCredentials,
      })
      .eq("id", tx.id)
      .select("credentials_delivered, delivered_data")
      .maybeSingle();
    txUpdateError = legacyTxUpdate.error;
    resolvedDeliveredData = extractDeliveredData((legacyTxUpdate.data ?? {}) as Record<string, unknown>);
  }

  if (txUpdateError) {
    return { ok: false, status: 500, error: `Failed to mark transaction completed: ${formatDbError(txUpdateError)}` };
  }

  if (resolvedDeliveredData.length === 0) {
    resolvedDeliveredData = deliveredCredentials;
  }

  const profileRow = buyerProfile;

  if (fromLogs > 0) {
    console.log("[PocketFiWebhook] Logs prepared for customer", {
      reference,
      email: profileRow?.email ?? null,
      admin_buyer: isAdminBuyer,
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
      delivered_data: resolvedDeliveredData,
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
    const env = resolveServiceEnv();
    console.error("[PocketFiWebhook] Supabase admin client setup failed", {
      error,
      missing_env: env.missing,
      has_next_public_supabase_url: Boolean((process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()),
      has_supabase_url: Boolean((process.env.SUPABASE_URL ?? "").trim()),
      has_service_role_key: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()),
    });
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
