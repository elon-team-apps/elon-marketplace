import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type DepositRow = {
  id: string;
  user_id: string;
  amount: number | null;
  reference: string | null;
  status: string | null;
};

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

async function verifyFlutterwaveByReference(txRef: string, secret: string): Promise<{ ok: true; amount: number } | { ok: false }> {
  const url = `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return { ok: false };
  }

  if (!response.ok) return { ok: false };
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const status = normalize(String(data.status ?? ""));
  const ref = String(data.tx_ref ?? data.reference ?? "").trim();
  const amount = asPositiveInt(data.amount, 0);
  if (status !== "successful" || !ref || ref !== txRef || amount <= 0) return { ok: false };
  return { ok: true, amount };
}

async function incrementBalance(supabaseAdmin: SupabaseClient, userId: string, amount: number): Promise<boolean> {
  let rpc = await supabaseAdmin.rpc("increment_balance", { user_id: userId, amount_to_add: amount });
  if (!rpc.error) return true;
  rpc = await supabaseAdmin.rpc("increment_balance", { p_user_id: userId, p_amount: amount });
  return !rpc.error;
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
  const flutterwaveSecret = (process.env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !flutterwaveSecret) {
    res.status(500).json({ error: "Server misconfigured." });
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

  const { data: rows, error: pendingError } = await adminClient
    .from("transactions")
    .select("id, user_id, amount, reference, status")
    .eq("type", "deposit")
    .in("status", ["pending", "initiated"])
    .order("created_at", { ascending: true })
    .limit(500);

  if (pendingError) {
    res.status(500).json({ error: `Failed to load pending deposits: ${pendingError.message}` });
    return;
  }

  const deposits = (rows ?? []) as DepositRow[];
  let checked = 0;
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of deposits) {
    checked += 1;
    const txRef = String(row.reference ?? "").trim();
    if (!txRef || !row.user_id) {
      skipped += 1;
      continue;
    }

    const verified = await verifyFlutterwaveByReference(txRef, flutterwaveSecret);
    if (!verified.ok) {
      skipped += 1;
      continue;
    }

    const updateAttempt = await adminClient
      .from("transactions")
      .update({ status: "completed", amount: verified.amount })
      .eq("id", row.id)
      .in("status", ["pending", "initiated"])
      .select("id")
      .maybeSingle();

    if (updateAttempt.error) {
      failed += 1;
      continue;
    }
    if (!updateAttempt.data) {
      skipped += 1;
      continue;
    }

    const credited = await incrementBalance(adminClient, row.user_id, verified.amount);
    if (!credited) {
      failed += 1;
      continue;
    }
    completed += 1;
  }

  res.status(200).json({
    ok: true,
    checked,
    completed,
    skipped,
    failed,
  });
}
