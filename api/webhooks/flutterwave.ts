import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { processSuccessfulTransaction, formatDbError, asPositiveInt } from "../_lib/processSuccessfulOrder";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders; body?: unknown };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type FlutterwaveEvent = {
  event?: string;
  data?: {
    tx_ref?: string;
    amount?: number | string;
    status?: string;
    meta?: Record<string, unknown>;
    customer?: { email?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

const SUPERADMIN_EMAILS = new Set([
  "growthprofesors@gmail.com",
  "godwindavid199501@gmail.com",
]);

function isSuperAdminEmail(email: string | null | undefined): boolean {
  return SUPERADMIN_EMAILS.has(normalize(email));
}

function getAdminClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Missing Supabase service env.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("column") && message.includes(column.toLowerCase()) && message.includes("does not exist");
}

async function canUseAdminBypass(req: ApiRequest): Promise<boolean> {
  if (normalize(headerValue(req.headers, "x-admin-bypass")) !== "true") return false;
  const authHeader = headerValue(req.headers, "authorization");
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anon) return false;
  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return false;
  return isSuperAdminEmail(data.user.email);
}

async function processDeposit(
  supabaseAdmin: SupabaseClient,
  txRef: string,
  amountRaw: unknown,
  meta: Record<string, unknown> | undefined,
) {
  const amount = Math.max(0, asPositiveInt(amountRaw, 0));
  const fallbackEmail = String(meta?.buyerEmail ?? "").trim().toLowerCase();
  const { data: tx, error: txError } = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, amount, status")
    .eq("reference", txRef)
    .eq("type", "deposit")
    .maybeSingle();
  if (txError) return { ok: false, status: 500, error: `Failed deposit lookup: ${formatDbError(txError)}` };
  if (tx?.status === "finalized" || tx?.status === "completed") {
    return { ok: true, status: 200, data: { ok: true, idempotent: true } };
  }
  let userId = String(tx?.user_id ?? meta?.userId ?? "").trim();
  if (!userId && fallbackEmail) {
    const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", fallbackEmail)
      .maybeSingle();
    if (profileByEmailError) {
      return { ok: false, status: 500, error: `Profile lookup by email failed: ${formatDbError(profileByEmailError)}` };
    }
    userId = String(profileByEmail?.id ?? "").trim();
    if (!userId) {
      console.error(`[FlutterwaveWebhook] Webhook Error: User ${fallbackEmail} not found in profiles`);
      return { ok: false, status: 404, error: `Webhook Error: User ${fallbackEmail} not found in profiles` };
    }
  }
  if (!userId) return { ok: false, status: 400, error: "Missing deposit userId." };
  const credit = Math.max(0, asPositiveInt(tx?.amount ?? amount, 0));
  if (!credit) return { ok: false, status: 400, error: "Invalid deposit amount." };

  const walletProfile = await supabaseAdmin
    .from("profiles")
    .select("wallet_balance")
    .eq("id", userId)
    .maybeSingle();
  let balanceField: "wallet_balance" | "balance" = "wallet_balance";
  let profile = walletProfile.data as { wallet_balance?: unknown } | null;
  let profileError = walletProfile.error;

  if (isMissingColumnError(walletProfile.error, "wallet_balance")) {
    balanceField = "balance";
    const legacyProfile = await supabaseAdmin
      .from("profiles")
      .select("balance")
      .eq("id", userId)
      .maybeSingle();
    profile = legacyProfile.data as { balance?: unknown } | null;
    profileError = legacyProfile.error;
  }

  if (profileError || !profile) return { ok: false, status: 500, error: `Profile lookup failed: ${formatDbError(profileError)}` };
  const current = Math.max(0, asPositiveInt((profile as Record<string, unknown>)[balanceField], 0));
  const next = current + credit;
  const updateAttempt = await supabaseAdmin
    .from("profiles")
    .update({ [balanceField]: next })
    .eq("id", userId)
    .eq(balanceField, current)
    .select(balanceField);
  let updated = updateAttempt.data;
  let updateError = updateAttempt.error;
  if (balanceField === "wallet_balance" && isMissingColumnError(updateError, "wallet_balance")) {
    balanceField = "balance";
    const retry = await supabaseAdmin
      .from("profiles")
      .update({ balance: next })
      .eq("id", userId)
      .eq("balance", current)
      .select("balance");
    updated = retry.data;
    updateError = retry.error;
  }
  if (updateError) return { ok: false, status: 500, error: `Balance update failed: ${formatDbError(updateError)}` };
  if (!Array.isArray(updated) || updated.length === 0) {
    return { ok: false, status: 409, error: "Concurrent balance update conflict." };
  }

  if (tx?.id) {
    const { error: txUpdateError } = await supabaseAdmin
      .from("transactions")
      .update({ status: "completed", amount: credit })
      .eq("id", tx.id);
    if (txUpdateError) return { ok: false, status: 500, error: `Deposit completion failed: ${formatDbError(txUpdateError)}` };
  }

  return { ok: true, status: 200, data: { ok: true, userId, wallet_balance: next, reference: txRef } };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, verif-hash, x-admin-bypass");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const bypassAllowed = await canUseAdminBypass(req);
  const webhookHash = (process.env.FLW_WEBHOOK_HASH ?? "").trim();
  const headerHash = headerValue(req.headers, "verif-hash") || headerValue(req.headers, "verif_hash");
  if (!bypassAllowed && (!webhookHash || headerHash !== webhookHash)) {
    console.error("[FlutterwaveWebhook] Hash mismatch", {
      headerHash,
      webhookHash,
      hasHeader: Boolean(headerHash),
      hasEnv: Boolean(webhookHash),
    });
    res.status(401).json({ error: "Invalid Flutterwave webhook signature." });
    return;
  }

  const payload = (req.body ?? {}) as FlutterwaveEvent;
  console.log("[FlutterwaveWebhook] Incoming event", {
    event: payload.event,
    status: payload.data?.status,
    tx_ref: payload.data?.tx_ref,
  });
  const status = normalize(payload.data?.status as string | undefined);
  const event = normalize(payload.event);
  if (!(event === "charge.completed" || event === "payment.success" || status === "successful")) {
    res.status(200).json({ ok: true, ignored: true, event: payload.event ?? null, status });
    return;
  }

  const txRef = String(payload.data?.tx_ref ?? payload.data?.reference ?? "").trim();
  if (!txRef) {
    res.status(400).json({ error: "Missing tx_ref." });
    return;
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = getAdminClient();
  } catch (error) {
    res.status(500).json({ error: `Server misconfigured: ${String(error)}` });
    return;
  }

  const { data: tx, error: txLookupError } = await supabaseAdmin
    .from("transactions")
    .select("id, type")
    .eq("reference", txRef)
    .maybeSingle();
  if (txLookupError) {
    res.status(500).json({ error: `Transaction lookup failed: ${formatDbError(txLookupError)}` });
    return;
  }

  const result = tx?.type === "deposit"
    ? await processDeposit(
      supabaseAdmin,
      txRef,
      payload.data?.amount,
      {
        ...(payload.data?.meta ?? {}),
        buyerEmail: payload.data?.customer?.email ?? (payload.data?.meta as Record<string, unknown> | undefined)?.buyerEmail,
      },
    )
    : tx?.id
      ? await processSuccessfulTransaction(supabaseAdmin, tx.id, payload.data?.amount)
      : { ok: false, status: 404, error: "No transaction found for tx_ref." };

  if (!result.ok) {
    res.status(result.status).json({ error: result.error ?? "Webhook processing failed." });
    return;
  }

  res.status(result.status).json(result.data ?? { ok: true });
}
