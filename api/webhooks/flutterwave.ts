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
  tx_ref?: string;
  status?: string;
  meta?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  data?: {
    tx_ref?: string;
    amount?: number | string;
    status?: string;
    meta?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
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

function headerValueCaseInsensitive(headers: ApiHeaders, key: string): string {
  const direct = headerValue(headers, key);
  if (direct) return direct;
  const target = key.trim().toLowerCase();
  for (const [name, raw] of Object.entries(headers)) {
    if (name.trim().toLowerCase() !== target) continue;
    if (Array.isArray(raw)) return String(raw[0] ?? "");
    return String(raw ?? "");
  }
  return "";
}

const SUPERADMIN_EMAILS = new Set([
  "growthprofesors@gmail.com",
  "godwindavid199501@gmail.com",
]);

function isSuperAdminEmail(email: string | null | undefined): boolean {
  return SUPERADMIN_EMAILS.has(normalize(email));
}

function getSupabaseServiceClient(): SupabaseClient {
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

async function incrementWalletAtomic(
  supabaseAdmin: SupabaseClient,
  userId: string,
  amount: number,
): Promise<{ ok: true; wallet_balance: number } | { ok: false; error: string; status?: number }> {
  const rpcAttempt = await supabaseAdmin.rpc("increment_wallet_balance", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (!rpcAttempt.error) {
    const next = Math.max(0, asPositiveInt(rpcAttempt.data, 0));
    return { ok: true, wallet_balance: next };
  }

  const rpcLegacyAttempt = await supabaseAdmin.rpc("increment_balance", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (!rpcLegacyAttempt.error) {
    const next = Math.max(0, asPositiveInt(rpcLegacyAttempt.data, 0));
    // Ensure modern UI field always reflects immediately even if legacy RPC only updates balance.
    const syncWallet = await supabaseAdmin
      .from("profiles")
      .update({ wallet_balance: next })
      .eq("id", userId);
    if (syncWallet.error && !isMissingColumnError(syncWallet.error, "wallet_balance")) {
      return { ok: false, status: 500, error: `Wallet sync failed: ${formatDbError(syncWallet.error)}` };
    }
    return { ok: true, wallet_balance: next };
  }

  // Fallback path if RPC is not deployed yet.
  const profileRead = await supabaseAdmin
    .from("profiles")
    .select("wallet_balance, balance")
    .eq("id", userId)
    .maybeSingle();

  let profile = profileRead.data as { wallet_balance?: unknown; balance?: unknown } | null;
  let profileError = profileRead.error;
  let hasWalletBalance = !isMissingColumnError(profileRead.error, "wallet_balance");
  let hasLegacyBalance = !isMissingColumnError(profileRead.error, "balance");

  if (profileRead.error && (isMissingColumnError(profileRead.error, "wallet_balance") || isMissingColumnError(profileRead.error, "balance"))) {
    const fallbackRead = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", userId)
      .maybeSingle();
    if (!fallbackRead.error && fallbackRead.data) {
      profile = fallbackRead.data as { wallet_balance?: unknown; balance?: unknown };
      profileError = null;
      hasWalletBalance = true;
      hasLegacyBalance = false;
    } else if (isMissingColumnError(fallbackRead.error, "wallet_balance")) {
      const legacyRead = await supabaseAdmin
        .from("profiles")
        .select("balance")
        .eq("id", userId)
        .maybeSingle();
      profile = legacyRead.data as { wallet_balance?: unknown; balance?: unknown } | null;
      profileError = legacyRead.error;
      hasWalletBalance = false;
      hasLegacyBalance = true;
    } else {
      profileError = fallbackRead.error;
    }
  }

  if (profileError || !profile) {
    return { ok: false, status: 500, error: `Profile lookup failed: ${formatDbError(profileError)}` };
  }

  const currentWallet = Math.max(0, asPositiveInt(profile.wallet_balance, 0));
  const currentLegacy = Math.max(0, asPositiveInt(profile.balance, 0));
  const nextWallet = currentWallet + amount;
  const nextLegacy = currentLegacy + amount;

  const updatePayload: Record<string, number> = {};
  if (hasWalletBalance) updatePayload.wallet_balance = nextWallet;
  if (hasLegacyBalance) updatePayload.balance = nextLegacy;
  if (!hasWalletBalance && !hasLegacyBalance) {
    return { ok: false, status: 500, error: "No balance column available on profiles table." };
  }

  const updateAttempt = await supabaseAdmin
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("wallet_balance, balance");
  if (updateAttempt.error) {
    return { ok: false, status: 500, error: `Balance update failed: ${formatDbError(updateAttempt.error)}` };
  }
  if (!Array.isArray(updateAttempt.data) || updateAttempt.data.length === 0) {
    return { ok: false, status: 409, error: "Balance update conflict." };
  }
  const updated = updateAttempt.data[0] as { wallet_balance?: unknown; balance?: unknown };
  return {
    ok: true,
    wallet_balance: Math.max(
      0,
      asPositiveInt(
        hasWalletBalance ? updated.wallet_balance : updated.balance,
        hasWalletBalance ? nextWallet : nextLegacy,
      ),
    ),
  };
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
  const primaryDepositLookup = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, amount, status")
    .eq("reference", txRef)
    .eq("type", "deposit")
    .maybeSingle();
  if (primaryDepositLookup.error) {
    return { ok: false, status: 500, error: `Failed deposit lookup: ${formatDbError(primaryDepositLookup.error)}` };
  }
  let tx = primaryDepositLookup.data as { id: string; user_id: string; amount: number; status: string } | null;
  if (!tx && fallbackEmail) {
    const profileByEmail = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", fallbackEmail)
      .maybeSingle();
    if (!profileByEmail.error && profileByEmail.data?.id) {
      const fallbackTxLookup = await supabaseAdmin
        .from("transactions")
        .select("id, user_id, amount, status")
        .eq("user_id", profileByEmail.data.id)
        .eq("type", "deposit")
        .in("status", ["pending", "initiated"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!fallbackTxLookup.error && Array.isArray(fallbackTxLookup.data) && fallbackTxLookup.data.length > 0) {
        tx = fallbackTxLookup.data[0] as { id: string; user_id: string; amount: number; status: string };
      }
    }
  }

  if (tx?.status === "finalized" || tx?.status === "completed" || tx?.status === "success") {
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

  const incremented = await incrementWalletAtomic(supabaseAdmin, userId, credit);
  if (!incremented.ok) {
    return { ok: false, status: incremented.status ?? 500, error: incremented.error };
  }
  const next = incremented.wallet_balance;

  if (tx?.id) {
    const { error: txUpdateError } = await supabaseAdmin
      .from("transactions")
      .update({ status: "completed", amount: credit })
      .eq("id", tx.id);
    if (txUpdateError) return { ok: false, status: 500, error: `Deposit completion failed: ${formatDbError(txUpdateError)}` };
  } else {
    const createdFallback = await supabaseAdmin
      .from("transactions")
      .insert({
        user_id: userId,
        amount: credit,
        type: "deposit",
        status: "completed",
        reference: txRef,
      })
      .select("id")
      .maybeSingle();
    if (createdFallback.error) {
      // Non-fatal for balance update, but log for reconciliation.
      console.error("[FlutterwaveWebhook] Could not create fallback deposit transaction row", {
        txRef,
        userId,
        error: formatDbError(createdFallback.error),
      });
    }
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

  const payload = (req.body ?? {}) as FlutterwaveEvent;
  const webhookStatus = normalize(payload.status) || normalize(payload.data?.status as string | undefined);
  const webhookTxRef = String(payload.tx_ref ?? payload.data?.tx_ref ?? payload.data?.reference ?? "").trim();
  console.log("WEBHOOK_RECEIVED", payload);
  console.log("PAYLOAD_SUCCESS", payload);
  console.log("WEBHOOK_STATUS", webhookStatus || null, webhookTxRef || null);
  console.log("[FlutterwaveWebhook] FULL_PAYLOAD_JSON", JSON.stringify(payload));

  const bypassAllowed = await canUseAdminBypass(req);
  const webhookHash = (process.env.FLW_WEBHOOK_HASH ?? "").trim();
  const headerHash = headerValueCaseInsensitive(req.headers, "verif-hash")
    || headerValueCaseInsensitive(req.headers, "verif_hash");
  if (!bypassAllowed && (!webhookHash || headerHash !== webhookHash)) {
    console.error("SECURITY: Webhook Hash Mismatch");
    console.error("[FlutterwaveWebhook] Hash mismatch", {
      headerHash,
      webhookHash,
      hasHeader: Boolean(headerHash),
      hasEnv: Boolean(webhookHash),
      reason: !webhookHash ? "Missing FLW_WEBHOOK_HASH env" : "Header verif-hash mismatch",
    });
    res.status(401).json({ error: "Invalid Flutterwave webhook signature." });
    return;
  }
  console.log("[FlutterwaveWebhook] Incoming event", {
    event: payload.event,
    status: payload.data?.status,
    tx_ref: payload.data?.tx_ref,
  });
  const status = webhookStatus;
  const event = normalize(payload.event);
  if (!(event === "charge.completed" || event === "payment.success" || status === "successful")) {
    res.status(200).json({ ok: true, ignored: true, event: payload.event ?? null, status });
    return;
  }

  const txRef = webhookTxRef;
  if (!txRef) {
    res.status(400).json({ error: "Missing tx_ref." });
    return;
  }

  let supabaseService: SupabaseClient;
  try {
    supabaseService = getSupabaseServiceClient();
  } catch (error) {
    res.status(500).json({ error: `Server misconfigured: ${String(error)}` });
    return;
  }

  const { data: tx, error: txLookupError } = await supabaseService
    .from("transactions")
    .select("id, type")
    .eq("reference", txRef)
    .maybeSingle();
  if (txLookupError) {
    res.status(500).json({ error: `Transaction lookup failed: ${formatDbError(txLookupError)}` });
    return;
  }

  const metaType = String((payload.data?.meta as Record<string, unknown> | undefined)?.type ?? "").trim().toLowerCase();
  const isWalletTopupMeta = metaType === "wallet_topup" || metaType === "deposit";
  console.log("[FlutterwaveWebhook] tx_ref verification", {
    tx_ref: txRef,
    matched_transaction_type: tx?.type ?? null,
    wallet_topup_meta: isWalletTopupMeta,
    tx_found: Boolean(tx?.id),
  });

  const result = tx?.type === "deposit" || (!tx?.id && isWalletTopupMeta)
    ? await processDeposit(
      supabaseService,
      txRef,
      payload.data?.amount,
      {
        ...(payload.meta ?? {}),
        ...(payload.metadata ?? {}),
        ...(payload.data?.metadata ?? {}),
        ...(payload.data?.meta ?? {}),
        buyerEmail:
          payload.data?.customer?.email
          ?? (payload.data?.meta as Record<string, unknown> | undefined)?.buyerEmail
          ?? (payload.data?.metadata as Record<string, unknown> | undefined)?.buyerEmail
          ?? (payload.meta as Record<string, unknown> | undefined)?.buyerEmail
          ?? (payload.metadata as Record<string, unknown> | undefined)?.buyerEmail,
      },
    )
    : tx?.id
      ? await processSuccessfulTransaction(supabaseService, tx.id, payload.data?.amount)
      : { ok: false, status: 404, error: "No transaction found for tx_ref." };

  if (!result.ok) {
    res.status(result.status).json({ error: result.error ?? "Webhook processing failed." });
    return;
  }

  res.status(result.status).json(result.data ?? { ok: true });
}
