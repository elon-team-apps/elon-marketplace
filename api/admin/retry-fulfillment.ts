import { createClient } from "@supabase/supabase-js";
import { isSuperAdminEmail } from "../../src/lib/adminAccess";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

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

function formatDeliveredLog(row: {
  email?: string | null;
  password?: string | null;
  recovery?: string | null;
  credentials?: string | null;
}): string {
  const clean = String(row.credentials ?? "").trim();
  if (clean) return clean;

  const email = String(row.email ?? "").trim();
  const password = String(row.password ?? "").trim();
  const recovery = String(row.recovery ?? "").trim();
  if (email && password) return `${email}:${password}:${recovery}`;
  return "";
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

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Server misconfigured for retry fulfillment." });
    return;
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user || !isSuperAdminEmail(userData.user.email)) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const transactionId = String((req.body as { transactionId?: string } | null)?.transactionId ?? "").trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(transactionId)) {
    res.status(400).json({ error: "Invalid transactionId." });
    return;
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: tx, error: txError } = await adminClient
    .from("transactions")
    .select("id, user_id, product_id, quantity, status, delivered_data")
    .eq("id", transactionId)
    .maybeSingle();
  if (txError || !tx) {
    res.status(404).json({ error: `Transaction not found: ${formatDbError(txError)}` });
    return;
  }

  const existingDelivered = String(tx.delivered_data ?? "").trim();
  if (existingDelivered) {
    res.status(200).json({ ok: true, delivered_data: existingDelivered.split(/\r?\n/).filter(Boolean), already_present: true });
    return;
  }

  const quantity = Math.max(1, Math.trunc(Number(tx.quantity ?? 1)));
  const { data: soldLogs, error: soldLogsError } = await adminClient
    .from("log_items")
    .select("id, email, password, recovery, credentials")
    .eq("buyer_id", tx.user_id)
    .eq("product_id", tx.product_id)
    .eq("status", "delivered")
    .order("created_at", { ascending: false })
    .limit(quantity);
  if (soldLogsError) {
    res.status(500).json({ error: `Failed to load sold logs: ${formatDbError(soldLogsError)}` });
    return;
  }

  const lines = (soldLogs ?? [])
    .map((row) => formatDeliveredLog(row as {
      email?: string | null;
      password?: string | null;
      recovery?: string | null;
      credentials?: string | null;
    }))
    .filter(Boolean)
    .reverse();
  if (lines.length === 0) {
    res.status(404).json({ error: "No delivered logs found for this transaction." });
    return;
  }

  const deliveredData = lines.join("\n");
  const { error: updateError } = await adminClient
    .from("transactions")
    .update({
      status: "completed",
      credentials_delivered: true,
      delivered_data: deliveredData,
    })
    .eq("id", transactionId);
  if (updateError) {
    res.status(500).json({ error: `Failed to update transaction delivery: ${formatDbError(updateError)}` });
    return;
  }

  res.status(200).json({ ok: true, delivered_data: lines, retried: true });
}
