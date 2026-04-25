import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type PurchaseBody = {
  productId?: string;
  quantity?: number | string;
};

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

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase()) && message.includes("does not exist");
}

async function insertWalletTransaction(
  supabaseAdmin: SupabaseClient,
  payload: {
    user_id: string;
    amount: number;
    type: "wallet_payment";
    status: "pending";
    reference: string;
    product_id: string;
    quantity: number;
    product_description: string;
  },
) {
  const first = await supabaseAdmin
    .from("transactions")
    .insert(payload)
    .select("id")
    .single();
  if (!first.error || !isMissingColumnError(first.error, "product_description")) return first;

  return supabaseAdmin
    .from("transactions")
    .insert({
      user_id: payload.user_id,
      amount: payload.amount,
      type: payload.type,
      status: payload.status,
      reference: payload.reference,
      product_id: payload.product_id,
      quantity: payload.quantity,
    })
    .select("id")
    .single();
}

function resolveServiceEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return {
    url: url || null,
    anonKey: anonKey || null,
    serviceRoleKey: serviceRoleKey || null,
  };
}

function getAdminClient(): SupabaseClient {
  const env = resolveServiceEnv();
  if (!env.url || !env.serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
}

function getUserClient(token: string): SupabaseClient {
  const env = resolveServiceEnv();
  if (!env.url || !env.anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY");
  }
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
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

async function readUserBalance(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<{ field: "wallet_balance" | "balance"; current: number } | { error: string }> {
  const walletProfile = await supabaseAdmin
    .from("profiles")
    .select("wallet_balance")
    .eq("id", userId)
    .maybeSingle();
  if (!walletProfile.error && walletProfile.data) {
    return {
      field: "wallet_balance",
      current: Math.max(0, asPositiveInt((walletProfile.data as { wallet_balance?: unknown }).wallet_balance, 0)),
    };
  }
  if (!isMissingColumnError(walletProfile.error, "wallet_balance")) {
    return { error: `Could not verify wallet balance: ${formatDbError(walletProfile.error)}` };
  }
  const legacyProfile = await supabaseAdmin
    .from("profiles")
    .select("balance")
    .eq("id", userId)
    .maybeSingle();
  if (legacyProfile.error || !legacyProfile.data) {
    return { error: `Could not verify wallet balance: ${formatDbError(legacyProfile.error)}` };
  }
  return {
    field: "balance",
    current: Math.max(0, asPositiveInt((legacyProfile.data as { balance?: unknown }).balance, 0)),
  };
}

async function updateUserBalance(
  supabaseAdmin: SupabaseClient,
  userId: string,
  field: "wallet_balance" | "balance",
  current: number,
  next: number,
): Promise<{ ok: true } | { ok: false; error: string; conflict?: boolean }> {
  const attempted = await supabaseAdmin
    .from("profiles")
    .update({ [field]: next })
    .eq("id", userId)
    .eq(field, current)
    .select(field);

  if (attempted.error && field === "wallet_balance" && isMissingColumnError(attempted.error, "wallet_balance")) {
    const retry = await supabaseAdmin
      .from("profiles")
      .update({ balance: next })
      .eq("id", userId)
      .eq("balance", current)
      .select("balance");
    if (retry.error) return { ok: false, error: `Failed to update wallet balance: ${formatDbError(retry.error)}` };
    const retryCount = Array.isArray(retry.data) ? retry.data.length : 0;
    if (retryCount === 0) return { ok: false, error: "Wallet balance changed before checkout could complete. Please try again.", conflict: true };
    return { ok: true };
  }

  if (attempted.error) return { ok: false, error: `Failed to update wallet balance: ${formatDbError(attempted.error)}` };
  const updatedCount = Array.isArray(attempted.data) ? attempted.data.length : 0;
  if (updatedCount === 0) return { ok: false, error: "Wallet balance changed before checkout could complete. Please try again.", conflict: true };
  return { ok: true };
}

async function fulfillWalletPurchase(
  supabaseAdmin: SupabaseClient,
  transactionId: string,
  amountNaira: number,
) {
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, product_id, amount, status, quantity, reference, type")
    .eq("id", transactionId)
    .maybeSingle();
  if (txError) return { ok: false, status: 500, error: `Failed to fetch transaction: ${formatDbError(txError)}` };
  if (!tx) return { ok: false, status: 404, error: "Wallet payment transaction was not found." };
  if (tx.status === "completed" || tx.status === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Already fulfilled.", idempotent: true } };
  }
  if (!tx.product_id) return { ok: false, status: 400, error: "Transaction has no product_id." };

  const quantity = Math.max(1, asPositiveInt(tx.quantity, 1));
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
    .eq("status", "available")
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
    content?: string | null;
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
      .eq("status", "available")
      .eq("is_delivered", false)
      .order("created_at", { ascending: true })
      .limit(quantity);
    if (availableLogsRes.error && isMissingColumnError(availableLogsRes.error, "content")) {
      availableLogsRes = await supabaseAdmin
        .from("log_items")
        .select("id, credentials, email, password, recovery")
        .eq("product_id", tx.product_id)
        .eq("status", "available")
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
      content?: string | null;
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
  if (productUpdateError) {
    return { ok: false, status: 500, error: `Failed to update product inventory: ${formatDbError(productUpdateError)}` };
  }

  const deliveredDataLines = logsToDeliver
    .slice(0, fromLogs)
    .map((row) => formatDeliveredLog(row))
    .filter(Boolean);
  const deliveredData = deliveredDataLines.join("\n");
  const hasDeliveredCredentials = deliveredDataLines.length > 0;
  const deliveryUpdate = await supabaseAdmin
    .from("transactions")
    .update({
      credentials_delivered: hasDeliveredCredentials,
      delivered_data: deliveredData,
    })
    .eq("id", tx.id);
  if (deliveryUpdate.error) {
    return { ok: false, status: 500, error: `Failed to save wallet delivered credentials: ${formatDbError(deliveryUpdate.error)}` };
  }

  const txUpdate = await supabaseAdmin
    .from("transactions")
    .update({
      status: "completed",
      amount: amountNaira > 0 ? amountNaira : tx.amount,
    })
    .eq("id", tx.id);
  if (txUpdate.error) {
    return { ok: false, status: 500, error: `Failed to mark wallet transaction completed: ${formatDbError(txUpdate.error)}` };
  }

  if (fromLogs > 0) {
    const logId = logsToDeliver[fromLogs - 1].id;
    const logIdUpdate = await supabaseAdmin.from("transactions").update({ log_id: logId }).eq("id", tx.id);
    if (logIdUpdate.error) {
      console.warn("[WalletPurchase] Non-fatal: failed to update transactions.log_id", {
        transactionId: tx.id,
        log_id: logId,
        error: formatDbError(logIdUpdate.error),
      });
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      reference: tx.reference,
      transactionId: tx.id,
      amount: amountNaira,
      delivered_data: deliveredDataLines,
    },
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const authHeader = headerValue(req.headers, "authorization");
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const body = (req.body ?? {}) as PurchaseBody;
  const productId = String(body.productId ?? "").trim();
  const quantity = Math.max(1, Math.min(10, asPositiveInt(body.quantity, 1)));
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(productId)) {
    res.status(400).json({ error: "Invalid productId." });
    return;
  }

  let supabaseAdmin: SupabaseClient;
  let supabaseUser: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
    supabaseUser = getUserClient(token);
  } catch (error) {
    console.error("[WalletPurchase] Client setup failed", { error });
    res.status(500).json({ error: "Server misconfigured for wallet purchase." });
    return;
  }

  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  const authedUser = authData.user;
  if (authError || !authedUser) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("products")
    .select("id, title, price, description")
    .eq("id", productId)
    .maybeSingle();
  if (productError || !product) {
    res.status(404).json({ error: `Product lookup failed: ${formatDbError(productError)}` });
    return;
  }

  const totalPrice = Math.max(0, asPositiveInt(product.price, 0) * quantity);
  if (totalPrice <= 0) {
    res.status(400).json({ error: "Invalid product price." });
    return;
  }

  const balanceRead = await readUserBalance(supabaseAdmin, authedUser.id);
  if ("error" in balanceRead) {
    res.status(500).json({ error: balanceRead.error });
    return;
  }
  const balanceField = balanceRead.field;
  const currentBalance = balanceRead.current;
  if (currentBalance < totalPrice) {
    res.status(409).json({
      error: `Insufficient wallet balance. Need ₦${(totalPrice - currentBalance).toLocaleString()} more.`,
      code: "INSUFFICIENT_BALANCE",
    });
    return;
  }
  const nextBalance = currentBalance - totalPrice;

  const reference = `wlt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const { data: insertedTx, error: insertError } = await insertWalletTransaction(supabaseAdmin, {
    user_id: authedUser.id,
    amount: totalPrice,
    type: "wallet_payment",
    status: "pending",
    reference,
    product_id: productId,
    product_description: String(product.description ?? ""),
    quantity,
  });
  if (insertError || !insertedTx) {
    res.status(500).json({ error: `Could not create wallet transaction: ${formatDbError(insertError)}` });
    return;
  }

  const balanceDeduction = await updateUserBalance(
    supabaseAdmin,
    authedUser.id,
    balanceField,
    currentBalance,
    nextBalance,
  );
  if (!balanceDeduction.ok) {
    const deductionError = balanceDeduction;
    await supabaseAdmin.from("transactions").update({ status: "failed" }).eq("id", insertedTx.id);
    res.status(deductionError.conflict ? 409 : 500).json({
      error: deductionError.error,
      ...(deductionError.conflict ? { code: "INSUFFICIENT_BALANCE" } : {}),
    });
    return;
  }
  const balanceAfter = nextBalance;

  const fulfilled = await fulfillWalletPurchase(supabaseAdmin, insertedTx.id, totalPrice);
  if (!fulfilled.ok) {
    console.error("[WalletPurchase] Fulfillment failed after deduction, refunding balance.", {
      transactionId: insertedTx.id,
      error: fulfilled.error,
    });
    await supabaseAdmin
      .from("profiles")
      .update({ [balanceField]: balanceAfter + totalPrice })
      .eq("id", authedUser.id);
    await supabaseAdmin
      .from("transactions")
      .update({ status: "failed" })
      .eq("id", insertedTx.id);
    res.status(fulfilled.status).json({ error: fulfilled.error ?? "Wallet fulfillment failed. Your balance was refunded." });
    return;
  }

  res.status(200).json({
    ...(fulfilled.data ?? { ok: true }),
    wallet_balance: balanceAfter,
    payment_method: "wallet",
  });
}
