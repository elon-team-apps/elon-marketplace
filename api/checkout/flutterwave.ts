import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type CheckoutBody = {
  productId?: string;
  quantity?: number | string;
  amount?: number | string;
  reference?: string;
};

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
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
  const msg = String(error.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

function getClients(token: string): { admin: SupabaseClient; user: SupabaseClient } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !anon || !service) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.");
  }
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const user = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { admin, user };
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

  const body = (req.body ?? {}) as CheckoutBody;
  const productId = String(body.productId ?? "").trim();
  const quantity = Math.max(1, Math.min(10, asPositiveInt(body.quantity, 1)));
  const amount = Math.max(0, asPositiveInt(body.amount, 0));
  const reference = String(body.reference ?? "").trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(productId)) {
    res.status(400).json({ error: "Invalid productId." });
    return;
  }
  if (!reference) {
    res.status(400).json({ error: "Missing transaction reference." });
    return;
  }
  if (amount <= 0) {
    res.status(400).json({ error: "Invalid payment amount." });
    return;
  }

  let admin: SupabaseClient;
  let user: SupabaseClient;
  try {
    const clients = getClients(token);
    admin = clients.admin;
    user = clients.user;
  } catch (error) {
    res.status(500).json({ error: `Server misconfigured: ${String(error)}` });
    return;
  }

  const { data: authData, error: authError } = await user.auth.getUser();
  if (authError || !authData.user) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, title, category, price, manual_stock, description")
    .eq("id", productId)
    .maybeSingle();
  if (productError || !product) {
    res.status(404).json({ error: `Product lookup failed: ${formatDbError(productError)}` });
    return;
  }

  const manualStock = Math.max(0, asPositiveInt(product.manual_stock, 0));
  const { count: availableLogs, error: countError } = await admin
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("status", "available")
    .eq("is_delivered", false);
  if (countError) {
    res.status(500).json({ error: `Failed to check inventory: ${formatDbError(countError)}` });
    return;
  }
  const live = Math.max(0, Number(availableLogs ?? 0));
  if (live + manualStock < quantity) {
    res.status(409).json({
      error: `Out of stock. available_logs=${live}, manual_stock=${manualStock}, requested=${quantity}`,
    });
    return;
  }

  const expected = Math.max(0, asPositiveInt(product.price, 0) * quantity);
  if (expected !== amount) {
    res.status(409).json({ error: `Amount mismatch. expected=${expected}, got=${amount}` });
    return;
  }

  const primaryInsert = await admin
    .from("transactions")
    .insert({
      user_id: authData.user.id,
      amount,
      type: "purchase",
      status: "pending",
      reference,
      product_id: productId,
      product_description: String(product.description ?? ""),
      product_title_snapshot: String(product.title ?? ""),
      product_category_snapshot: String(product.category ?? ""),
      quantity,
    })
    .select("id")
    .single();
  let insert = primaryInsert;
  if (
    primaryInsert.error &&
    (
      isMissingColumnError(primaryInsert.error, "product_description") ||
      isMissingColumnError(primaryInsert.error, "product_title_snapshot") ||
      isMissingColumnError(primaryInsert.error, "product_category_snapshot")
    )
  ) {
    insert = await admin
      .from("transactions")
      .insert({
        user_id: authData.user.id,
        amount,
        type: "purchase",
        status: "pending",
        reference,
        product_id: productId,
        quantity,
      })
      .select("id")
      .single();
  }
  if (insert.error || !insert.data) {
    res.status(500).json({ error: `Failed to create pending transaction: ${formatDbError(insert.error)}` });
    return;
  }

  res.status(200).json({
    ok: true,
    transactionId: insert.data.id,
    reference,
    amount,
    quantity,
  });
}
