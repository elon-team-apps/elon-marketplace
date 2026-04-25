import { createClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = {
  method?: string;
  headers: ApiHeaders;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function firstQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
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
    res.status(500).json({ error: "Server misconfigured for webhook verifications." });
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

  const txRef = firstQueryValue(req.query?.tx_ref ?? req.query?.txRef);
  const decision = firstQueryValue(req.query?.decision).toLowerCase();
  const limit = Math.max(1, Math.min(100, asPositiveInt(req.query?.limit, 25)));

  let query = adminClient
    .from("webhook_verifications")
    .select("id, provider, tx_ref, decision, reason, expected_amount, verified_amount, created_at")
    .eq("provider", "flutterwave")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (txRef) {
    query = query.eq("tx_ref", txRef);
  }
  if (decision === "accepted" || decision === "rejected") {
    query = query.eq("decision", decision);
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: `Failed to load webhook verifications: ${error.message}` });
    return;
  }

  res.status(200).json({
    ok: true,
    count: Array.isArray(data) ? data.length : 0,
    records: data ?? [],
  });
}
