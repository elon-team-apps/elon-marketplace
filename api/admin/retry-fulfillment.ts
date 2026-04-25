import { createClient } from "@supabase/supabase-js";
import { processSuccessfulTransaction } from "../_lib/processSuccessfulOrder.js";

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
  if (userError || !userData.user) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const role = String(profile.role ?? "").toLowerCase();
  const adminFlag = profile.is_admin === true || profile.is_admin === "true" || profile.is_admin === "t";
  if (!adminFlag && role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const transactionId = String((req.body as { transactionId?: string } | null)?.transactionId ?? "").trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(transactionId)) {
    res.status(400).json({ error: "Invalid transactionId." });
    return;
  }

  const result = await processSuccessfulTransaction(adminClient, transactionId, 0, {
    allowRecoveryForCompletedWithoutDelivery: true,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error ?? "Retry fulfillment failed." });
    return;
  }
  res.status(result.status).json(result.data ?? { ok: true, retried: true });
}
