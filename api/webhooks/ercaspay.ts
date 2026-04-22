import { createHmac, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ErcasPayWebhookEvent = {
  event?: string;
  type?: string;
  data?: {
    reference?: string;
    payment_reference?: string;
    status?: string;
    amount?: number | string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

const SUPERADMIN_EMAILS = new Set([
  "growthprofesors@gmail.com",
  "godwindavid199501@gmail.com",
]);

function isSuperAdminEmail(email: string | null | undefined): boolean {
  return SUPERADMIN_EMAILS.has(normalize(email));
}

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function formatDbError(error: { message?: string; code?: string; details?: string; hint?: string } | null | undefined): string {
  if (!error) return "Unknown database error.";
  return [
    error.message ? `message=${error.message}` : "",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean).join(" | ") || "Unknown database error.";
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return `message=${error.message}`;
  if (error && typeof error === "object") {
    try {
      return `raw=${JSON.stringify(error)}`;
    } catch {
      return "raw=[unserializable error object]";
    }
  }
  return `raw=${String(error)}`;
}

function verifySignature(rawBody: string, headerSignature: string, secret: string): boolean {
  const computed = createHmac("sha512", secret).update(rawBody).digest("hex");
  const provided = headerSignature.trim().toLowerCase();
  const expected = computed.trim().toLowerCase();
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function resolveServiceEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return { url: url || null, serviceRoleKey: serviceRoleKey || null };
}

function getAdminClient(): SupabaseClient {
  const env = resolveServiceEnv();
  if (!env.url || !env.serviceRoleKey) {
    throw new Error("Missing SUPABASE URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
}

async function canUseAdminBypass(req: ApiRequest): Promise<boolean> {
  if (normalize(headerValue(req.headers, "x-admin-bypass")) !== "true") return false;
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
  return isSuperAdminEmail(data.user.email);
}

function formatDeliveredLog(row: {
  email?: string | null;
  password?: string | null;
  recovery?: string | null;
  credentials?: string | null;
}): string {
  const email = String(row.email ?? "").trim();
  const password = String(row.password ?? "").trim();
  const recovery = String(row.recovery ?? "").trim();
  if (email && password) return `${email}:${password}:${recovery}`;

  const clean = String(row.credentials ?? "").trim();
  if (!clean) return "";
  const parts = clean.includes("|") ? clean.split("|") : clean.split(":");
  const first = String(parts[0] ?? "").trim();
  const second = String(parts[1] ?? "").trim();
  const third = String(parts.slice(2).join(":") ?? "").trim();
  if (!first || !second) return clean;
  return `${first}:${second}:${third}`;
}

async function processDepositFromReference(supabaseAdmin: SupabaseClient, reference: string, amountRaw: unknown) {
  const amountNaira = Math.max(0, asPositiveInt(amountRaw, 0));
  const { data, error } = await supabaseAdmin.rpc("process_deposit", {
    p_reference: reference,
    p_amount_naira: amountNaira,
  });
  if (error) return { ok: false, status: 500, error: `Failed to process wallet deposit: ${formatDbError(error)}` };

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.success === false) {
    return {
      ok: false,
      status: 409,
      error: typeof payload.message === "string" && payload.message ? payload.message : "Wallet deposit verification failed.",
    };
  }

  return {
    ok: true,
    status: 200,
    data: { ok: true, processed: true, transaction_type: "deposit", reference, amount_naira: amountNaira, result: payload },
  };
}

async function fulfillPurchaseFromReference(supabaseAdmin: SupabaseClient, reference: string, amountRaw: unknown) {
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference")
    .eq("reference", reference)
    .eq("type", "purchase")
    .maybeSingle();
  if (txError) return { ok: false, status: 500, error: `Failed to fetch transaction: ${formatDbError(txError)}` };
  if (!tx) return { ok: true, status: 200, data: { ok: true, message: "No purchase row matched this reference." } };
  if (tx.status === "completed" || tx.status === "success") return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  if (!tx.product_id) return { ok: false, status: 400, error: "Transaction has no product_id." };

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = Math.max(0, asPositiveInt(amountRaw, 0)) || asPositiveInt(tx.amount, 0);
  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, stock, status, manual_stock")
    .eq("id", tx.product_id)
    .maybeSingle();
  if (productError || !product) return { ok: false, status: 500, error: `Failed to fetch product for fulfillment: ${formatDbError(productError)}` };

  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));
  const { count: rawAvailableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError && manualStock < quantity) {
    return {
      ok: false,
      status: 500,
      error: `Failed to count available logs: ${formatDbError(countError)}`,
    };
  }
  const availableLogCount = countError ? 0 : Math.max(0, Number(rawAvailableLogCount ?? 0));
  if (availableLogCount + manualStock < quantity) {
    return { ok: false, status: 409, error: `Insufficient stock. available_logs=${availableLogCount}, manual_stock=${manualStock}, requested=${quantity}` };
  }

  const { data: availableLogs, error: logFetchError } = await supabaseAdmin
    .from("log_items")
    .select("id, credentials, email, password, recovery")
    .eq("product_id", tx.product_id)
    .eq("status", "available")
    .eq("is_delivered", false)
    .order("created_at", { ascending: true })
    .limit(quantity);
  if (logFetchError && manualStock < quantity) return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${formatDbError(logFetchError)}` };
  const logsToDeliver = (availableLogs ?? []) as Array<{ id: string; credentials: string | null; email: string | null; password: string | null; recovery: string | null }>;

  const fromLogs = Math.min(logsToDeliver.length, quantity);
  const fromManual = quantity - fromLogs;
  if (fromManual > manualStock) return { ok: false, status: 409, error: `Insufficient stock. needed_manual=${fromManual}, manual_stock=${manualStock}` };

  if (fromLogs > 0) {
    const logIds = logsToDeliver.slice(0, fromLogs).map((row) => row.id);
    const { error } = await supabaseAdmin
      .from("log_items")
      .update({ is_delivered: true, status: "delivered", buyer_id: tx.user_id })
      .in("id", logIds);
    if (error) return { ok: false, status: 500, error: `Failed to mark delivered logs: ${formatDbError(error)}` };
  }

  const newManualStock = manualStock - fromManual;
  const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
  const nextStock = Math.max(0, currentStock - quantity);
  const nextStatus = (Math.max(0, availableLogCount - fromLogs) + newManualStock) > 0 ? "available" : "sold_out";
  const { error: productUpdateError } = await supabaseAdmin
    .from("products")
    .update({ manual_stock: newManualStock, stock: nextStock, status: nextStatus })
    .eq("id", tx.product_id);
  if (productUpdateError) return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(productUpdateError)}` };

  const deliveredDataLines = logsToDeliver.slice(0, fromLogs).map((row) => formatDeliveredLog(row)).filter(Boolean);
  const deliveredData = deliveredDataLines.join("\n");
  const hasDeliveredCredentials = deliveredDataLines.length > 0;
  const txUpdate = await supabaseAdmin
    .from("transactions")
    .update({
      status: "completed",
      amount: amountNaira > 0 ? amountNaira : tx.amount,
      credentials_delivered: hasDeliveredCredentials,
      delivered_data: deliveredData,
    })
    .eq("id", tx.id);
  if (txUpdate.error) return { ok: false, status: 500, error: `Failed to save delivered transaction update: ${formatDbError(txUpdate.error)}` };

  if (fromLogs > 0) {
    const { error } = await supabaseAdmin.from("transactions").update({ log_id: logsToDeliver[fromLogs - 1].id }).eq("id", tx.id);
    if (error) {
      console.warn("[ErcasPayWebhook] Non-fatal: failed to update transactions.log_id", {
        reference, transaction_id: tx.id, log_id: logsToDeliver[fromLogs - 1].id, error: formatDbError(error),
      });
    }
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
      delivered_data: deliveredDataLines,
    },
  };
}

function isSuccessfulEvent(payload: ErcasPayWebhookEvent): boolean {
  const event = normalize(payload.event ?? payload.type);
  const status = normalize(payload.data?.status as string | undefined);
  return (
    event === "payment.success" ||
    event === "charge.success" ||
    event === "transaction.success" ||
    status === "success" ||
    status === "successful" ||
    status === "completed" ||
    status === "paid"
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-ercaspay-signature, x-signature, x-admin-bypass");

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
  const secret = (process.env.ERCASPAY_SECRET_KEY ?? "").trim();
  if (!secret && !bypassAllowed) {
    res.status(500).json({ error: "Server misconfigured: missing ErcasPay secret." });
    return;
  }

  const signature =
    headerValue(req.headers, "x-ercaspay-signature") ||
    headerValue(req.headers, "x-signature") ||
    headerValue(req.headers, "ercaspay-signature");
  if (secret && !bypassAllowed && !verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: "Invalid signature." });
    return;
  }

  const payload = (req.body ?? {}) as ErcasPayWebhookEvent;
  if (!isSuccessfulEvent(payload)) {
    res.status(200).json({ ok: true, ignored: true, event: payload.event ?? payload.type ?? null });
    return;
  }

  const reference = String(payload.data?.reference ?? payload.data?.payment_reference ?? "").trim();
  if (!reference) {
    res.status(400).json({ error: "Missing transaction reference." });
    return;
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
  } catch (error) {
    console.error("[ErcasPayWebhook] Supabase admin client setup failed", { error });
    res.status(500).json({
      error: "Server misconfigured for fulfillment.",
      details: formatUnknownError(error),
    });
    return;
  }

  const { data: transaction, error: transactionError } = await supabaseAdmin
    .from("transactions")
    .select("id, type")
    .eq("reference", reference)
    .maybeSingle();
  if (transactionError) {
    console.error("[ErcasPayWebhook] Failed to identify transaction type", { reference, error: formatDbError(transactionError) });
    res.status(500).json({ error: `Failed to identify transaction type: ${formatDbError(transactionError)}` });
    return;
  }

  const fulfilled = transaction?.type === "deposit"
    ? await processDepositFromReference(supabaseAdmin, reference, payload.data?.amount)
    : await fulfillPurchaseFromReference(supabaseAdmin, reference, payload.data?.amount);
  if (!fulfilled.ok) {
    console.error("[ErcasPayWebhook] Fulfillment failed", { reference, error: fulfilled.error, payload });
    res.status(fulfilled.status).json({ error: fulfilled.error ?? "Fulfillment failed." });
    return;
  }

  res.status(fulfilled.status).json(fulfilled.data ?? { ok: true });
}
