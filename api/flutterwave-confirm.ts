import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type ConfirmBody = {
  tx_ref?: string;
  reference?: string;
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

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function getEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const flutterwaveSecret = (process.env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
  return { url, anon, service, flutterwaveSecret };
}

function getUserClient(token: string): SupabaseClient {
  const env = getEnv();
  if (!env.url || !env.anon) throw new Error("Missing Supabase anon environment.");
  return createClient(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getAdminClient(): SupabaseClient {
  const env = getEnv();
  if (!env.url || !env.service) throw new Error("Missing Supabase service environment.");
  return createClient(env.url, env.service, { auth: { persistSession: false } });
}

async function verifyFlutterwaveByReference(txRef: string): Promise<{ ok: true; amount: number } | { ok: false; error: string; status?: number }> {
  const secret = getEnv().flutterwaveSecret;
  if (!secret) return { ok: false, status: 500, error: "Missing FLUTTERWAVE_SECRET_KEY env." };

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
  } catch (error) {
    return { ok: false, status: 502, error: `Flutterwave verify request failed: ${String(error)}` };
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: `Flutterwave verify failed. status=${response.status} message=${String(payload.message ?? payload.error ?? "Unknown error")}`,
    };
  }

  const data = (payload.data ?? {}) as Record<string, unknown>;
  const verifiedTxRef = String(data.tx_ref ?? data.reference ?? "").trim();
  const verifiedStatus = normalize(String(data.status ?? ""));
  const verifiedAmount = Math.max(0, asPositiveInt(data.amount, 0));

  if (!verifiedTxRef || verifiedTxRef !== txRef) {
    return { ok: false, status: 409, error: "Flutterwave verify tx_ref mismatch." };
  }
  if (verifiedStatus !== "successful") {
    return { ok: false, status: 409, error: `Flutterwave verify status is ${verifiedStatus || "unknown"}, not successful.` };
  }
  if (!verifiedAmount) {
    return { ok: false, status: 409, error: "Flutterwave verify returned invalid amount." };
  }

  return { ok: true, amount: verifiedAmount };
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

  let userClient: SupabaseClient;
  let adminClient: SupabaseClient;
  try {
    userClient = getUserClient(token);
    adminClient = getAdminClient();
  } catch (error) {
    res.status(500).json({ error: `Server misconfigured: ${String(error)}` });
    return;
  }

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    res.status(401).json({ error: "Invalid or expired session." });
    return;
  }

  const body = (req.body ?? {}) as ConfirmBody;
  const txRef = String(body.tx_ref ?? body.reference ?? "").trim();
  if (!txRef) {
    res.status(400).json({ error: "Missing tx_ref." });
    return;
  }

  const txLookup = await adminClient
    .from("transactions")
    .select("id, user_id, status, amount")
    .eq("reference", txRef)
    .eq("type", "deposit")
    .maybeSingle();

  if (txLookup.error || !txLookup.data) {
    res.status(404).json({ error: `Deposit transaction not found: ${formatDbError(txLookup.error)}` });
    return;
  }
  if (String(txLookup.data.user_id ?? "") !== authData.user.id) {
    res.status(403).json({ error: "Not allowed to confirm this transaction." });
    return;
  }

  const currentStatus = normalize(String(txLookup.data.status ?? ""));
  if (currentStatus === "completed" || currentStatus === "finalized" || currentStatus === "success") {
    res.status(200).json({ ok: true, status: "completed", idempotent: true });
    return;
  }

  const verified = await verifyFlutterwaveByReference(txRef);
  if (!verified.ok) {
    res.status(verified.status ?? 409).json({ error: verified.error });
    return;
  }

  const updateTx = await adminClient
    .from("transactions")
    .update({ status: "completed", amount: verified.amount })
    .eq("id", txLookup.data.id)
    .in("status", ["pending", "initiated"])
    .select("id, user_id")
    .maybeSingle();

  if (updateTx.error) {
    res.status(500).json({ error: `Failed to complete deposit: ${formatDbError(updateTx.error)}` });
    return;
  }

  // If someone else (webhook) completed first, don't credit twice.
  if (!updateTx.data) {
    const latest = await adminClient
      .from("transactions")
      .select("status")
      .eq("id", txLookup.data.id)
      .maybeSingle();
    const latestStatus = normalize(String(latest.data?.status ?? ""));
    if (latestStatus === "completed" || latestStatus === "finalized" || latestStatus === "success") {
      res.status(200).json({ ok: true, status: "completed", idempotent: true });
      return;
    }
    res.status(409).json({ error: "Deposit completion conflict." });
    return;
  }

  let balanceRpc = await adminClient.rpc("increment_balance", {
    user_id: updateTx.data.user_id,
    amount_to_add: verified.amount,
  });
  if (balanceRpc.error) {
    balanceRpc = await adminClient.rpc("increment_balance", {
      p_user_id: updateTx.data.user_id,
      p_amount: verified.amount,
    });
  }
  if (balanceRpc.error) {
    res.status(500).json({ error: `Failed to credit wallet: ${formatDbError(balanceRpc.error)}` });
    return;
  }

  res.status(200).json({ ok: true, status: "completed", amount: verified.amount });
}
