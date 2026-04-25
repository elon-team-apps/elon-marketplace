import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSuperAdminEmail } from "@/lib/adminAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaystackWebhookEvent = {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number | string;
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

function formatDbError(error: { message?: string; code?: string; details?: string; hint?: string } | null | undefined): string {
  if (!error) return "Unknown database error.";
  return [
    error.message ? `message=${error.message}` : "",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean).join(" | ") || "Unknown database error.";
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase()) && message.includes("does not exist");
}

function extractDeliveredData(payload: Record<string, unknown>): string[] {
  const raw = payload.delivered_data ?? payload.credentials_delivered;
  if (typeof raw === "string") return raw.split(/\r?\n/).filter((line) => line.length > 0);
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "")).filter((line) => line.length > 0);
}

function formatDeliveredLog(row: {
  content?: string | null;
  email?: string | null;
  password?: string | null;
  recovery?: string | null;
  credentials?: string | null;
}): string {
  const content = String(row.content ?? "");
  if (content.trim()) return content;

  const cred = String(row.credentials ?? "");
  if (cred.trim()) return cred;

  return "";
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
  return {
    url: url || null,
    serviceRoleKey: serviceRoleKey || null,
  };
}

function getAdminClient(): SupabaseClient {
  const env = resolveServiceEnv();
  if (!env.url || !env.serviceRoleKey) {
    console.error("[PaystackWebhook] Missing admin env", {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(env.url),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(env.serviceRoleKey),
    });
    throw new Error("Missing SUPABASE URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
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
  return isSuperAdminEmail(data.user.email);
}

async function processDepositFromReference(supabaseAdmin: SupabaseClient, reference: string, amountKoboRaw: unknown) {
  const amountNaira = Math.max(0, Math.floor(asPositiveInt(amountKoboRaw, 0) / 100));
  const { data, error } = await supabaseAdmin.rpc("process_deposit", {
    p_reference: reference,
    p_amount_naira: amountNaira,
  });
  if (error) {
    return { ok: false, status: 500, error: `Failed to process wallet deposit: ${formatDbError(error)}` };
  }

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
    data: {
      ok: true,
      processed: true,
      transaction_type: "deposit",
      reference,
      amount_naira: amountNaira,
      result: payload,
    },
  };
}

async function fulfillPurchaseFromReference(supabaseAdmin: SupabaseClient, reference: string, amountKoboRaw: unknown) {
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

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
  const amountNaira = Math.max(0, Math.floor(asPositiveInt(amountKoboRaw, 0) / 100)) || asPositiveInt(tx.amount, 0);
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
  const { count: rawAvailableLogCount, error: countError } = await supabaseAdmin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", tx.product_id)
    .eq("is_delivered", false);
  if (countError && manualStock < quantity) {
    return { ok: false, status: 500, error: `Failed to count available logs: ${formatDbError(countError)}` };
  }
  const availableLogCount = countError ? 0 : Math.max(0, Number(rawAvailableLogCount ?? 0));
  if (availableLogCount + manualStock < quantity) {
    return {
      ok: false,
      status: 409,
      error: `Insufficient stock. available_logs=${availableLogCount}, manual_stock=${manualStock}, requested=${quantity}`,
    };
  }

  let logsToDeliver: Array<{
    id: string;
    content: string | null;
    credentials: string | null;
    email: string | null;
    password: string | null;
    recovery: string | null;
  }> = [];
  if (availableLogCount > 0) {
    let availableLogsRes = await supabaseAdmin
      .from("log_items")
      .select("id, content, credentials, email, password, recovery")
      .eq("product_id", tx.product_id)
      .eq("is_delivered", false)
      .order("created_at", { ascending: true })
      .limit(quantity);
    if (availableLogsRes.error && isMissingColumnError(availableLogsRes.error, "content")) {
      availableLogsRes = await supabaseAdmin
        .from("log_items")
        .select("id, credentials, email, password, recovery")
        .eq("product_id", tx.product_id)
        .eq("is_delivered", false)
        .order("created_at", { ascending: true })
        .limit(quantity);
    }
    const logFetchError = availableLogsRes.error;
    const availableLogs = availableLogsRes.data;
    if (logFetchError && manualStock < quantity) {
      return { ok: false, status: 500, error: `Failed to fetch logs for fulfillment: ${formatDbError(logFetchError)}` };
    }
    logsToDeliver = (availableLogs ?? []) as Array<{
      id: string;
      content: string | null;
      credentials: string | null;
      email: string | null;
      password: string | null;
      recovery: string | null;
    }>;
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
      .update({ is_delivered: true, status: "delivered", buyer_id: tx.user_id })
      .in("id", logIds);
    if (markDeliveredError) {
      return { ok: false, status: 500, error: `Failed to mark delivered logs: ${formatDbError(markDeliveredError)}` };
    }
  }

  const newManualStock = manualStock - fromManual;
  const currentStock = Math.max(0, asPositiveInt(product.stock, 0));
  const newStock = Math.max(0, currentStock - quantity);
  const remainingLogs = Math.max(0, availableLogCount - fromLogs);
  const nextProductStatus = remainingLogs + newManualStock > 0 ? "available" : "sold_out";
  const { error: updateProductError } = await supabaseAdmin
    .from("products")
    .update({ manual_stock: newManualStock, stock: newStock, status: nextProductStatus })
    .eq("id", tx.product_id);
  if (updateProductError) {
    return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(updateProductError)}` };
  }

  const deliveredDataLines = logsToDeliver
    .slice(0, fromLogs)
    .map((row) => formatDeliveredLog(row))
    .filter(Boolean);
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
  if (txUpdate.error) {
    return { ok: false, status: 500, error: `Failed to save delivered transaction update: ${formatDbError(txUpdate.error)}` };
  }

  if (fromLogs > 0) {
    const logId = logsToDeliver[fromLogs - 1].id;
    const logIdUpdate = await supabaseAdmin.from("transactions").update({ log_id: logId }).eq("id", tx.id);
    if (logIdUpdate.error) {
      console.warn("[PaystackWebhook] Non-fatal: failed to update transactions.log_id", {
        reference, transaction_id: tx.id, log_id: logId, error: formatDbError(logIdUpdate.error),
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
      delivered_data: deliveredDataLines.length > 0 ? deliveredDataLines : extractDeliveredData({ delivered_data: deliveredData }),
    },
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const bypassAllowed = await canUseAdminBypass(req);
  const paystackSecret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

  if (!paystackSecret && !bypassAllowed) {
    console.error("[PaystackWebhook] Missing PAYSTACK_SECRET_KEY");
    return json({ error: "Server misconfigured: missing Paystack secret." }, 500);
  }

  if (paystackSecret && !bypassAllowed && !verifySignature(rawBody, signature, paystackSecret)) {
    console.error("[PaystackWebhook] Invalid signature", {
      signature_present: Boolean(signature),
      body_preview: rawBody.slice(0, 300),
    });
    return json({ error: "Invalid signature." }, 401);
  }

  let payload: PaystackWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as PaystackWebhookEvent;
  } catch (error) {
    console.error("[PaystackWebhook] Invalid JSON payload", { error, rawBody });
    return json({ error: "Invalid JSON payload." }, 400);
  }

  if (payload.event !== "charge.success") {
    return json({ ok: true, message: `Ignored event ${payload.event ?? "unknown"}.` }, 200);
  }

  const reference = String(payload.data?.reference ?? "").trim();
  if (!reference) {
    return json({ error: "Missing transaction reference." }, 400);
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
  } catch (error) {
    console.error("[PaystackWebhook] Supabase admin client setup failed", { error });
    return json({ error: "Server misconfigured for fulfillment." }, 500);
  }

  const { data: transaction, error: transactionError } = await supabaseAdmin
    .from("transactions")
    .select("id, type")
    .eq("reference", reference)
    .maybeSingle();
  if (transactionError) {
    console.error("[PaystackWebhook] Failed to identify transaction type", { reference, error: formatDbError(transactionError) });
    return json({ error: `Failed to identify transaction type: ${formatDbError(transactionError)}` }, 500);
  }

  const fulfilled = transaction?.type === "deposit"
    ? await processDepositFromReference(supabaseAdmin, reference, payload.data?.amount)
    : await fulfillPurchaseFromReference(supabaseAdmin, reference, payload.data?.amount);
  if (!fulfilled.ok) {
    console.error("[PaystackWebhook] Fulfillment failed", { reference, error: fulfilled.error, payload });
    return json({ error: fulfilled.error ?? "Fulfillment failed." }, fulfilled.status);
  }

  return json(fulfilled.data ?? { ok: true }, fulfilled.status);
}
