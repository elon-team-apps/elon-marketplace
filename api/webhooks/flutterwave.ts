/// <reference path="../next-shim.d.ts" />
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";

type ProcessSuccessfulTransactionFn = (
  supabaseAdmin: SupabaseClient,
  transactionId: string,
  amountNairaRaw: unknown,
  options?: { allowRecoveryForCompletedWithoutDelivery?: boolean },
) => Promise<{ ok: boolean; status: number; error?: string; data?: unknown }>;

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

async function loadProcessSuccessfulTransaction(): Promise<ProcessSuccessfulTransactionFn> {
  try {
    const module = await import("./_lib/processSuccessfulOrder");
    const fn = module.processSuccessfulTransaction as ProcessSuccessfulTransactionFn | undefined;
    if (typeof fn === "function") return fn;
  } catch {
    // Fallback to explicit extension below.
  }

  const fallbackModule = await import("./_lib/processSuccessfulOrder.js");
  const fallbackFn = fallbackModule.processSuccessfulTransaction as ProcessSuccessfulTransactionFn | undefined;
  if (typeof fallbackFn === "function") return fallbackFn;
  throw new Error("processSuccessfulTransaction export not found.");
}

type ApiHeaders = Record<string, string | string[] | undefined>;

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

export const config = {
  api: {
    bodyParser: true,
  },
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function isSuccessfulGatewayStatus(value: string | null | undefined): boolean {
  const status = normalize(value);
  return status === "successful" || status === "success" || status === "completed" || status === "finalized";
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

type FlutterwaveVerifyResult =
  | { ok: true; txRef: string; status: string; amount: number }
  | { ok: false; error: string; status?: number };

async function writeVerificationAudit(
  supabaseService: SupabaseClient,
  params: {
    txRef: string;
    decision: "accepted" | "rejected";
    reason?: string;
    expectedAmount?: number;
    verifiedAmount?: number;
    payload?: unknown;
  },
): Promise<void> {
  const { error } = await supabaseService.from("webhook_verifications").insert({
    provider: "flutterwave",
    tx_ref: params.txRef,
    decision: params.decision,
    reason: params.reason ?? null,
    expected_amount: params.expectedAmount ?? null,
    verified_amount: params.verifiedAmount ?? null,
    payload: (params.payload ?? null) as Record<string, unknown> | null,
  });
  if (error) {
    console.error("[FlutterwaveWebhook] Failed to write webhook verification audit", {
      tx_ref: params.txRef,
      decision: params.decision,
      error: formatDbError(error),
    });
  }
}

async function verifyFlutterwaveByReference(txRef: string): Promise<FlutterwaveVerifyResult> {
  const secret = (process.env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
  if (!secret) {
    return { ok: false, status: 500, error: "Missing FLUTTERWAVE_SECRET_KEY env." };
  }

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
  if (!isSuccessfulGatewayStatus(verifiedStatus)) {
    return { ok: false, status: 409, error: `Flutterwave verify status is ${verifiedStatus || "unknown"}, not successful.` };
  }

  return { ok: true, txRef: verifiedTxRef, status: verifiedStatus, amount: verifiedAmount };
}

async function canUseAdminBypass(req: NextApiRequest, txRef?: string): Promise<boolean> {
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

  // 1. Check if user is Admin
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role, is_admin")
    .eq("id", data.user.id)
    .maybeSingle();
  
  if (!profileError && profile) {
    const role = String(profile.role ?? "").toLowerCase();
    const adminFlag = profile.is_admin === true || profile.is_admin === "true" || profile.is_admin === "t";
    if (adminFlag || role === "admin") return true;
  }

  // 2. Check if user is the Owner of the transaction (for reconciliation)
  if (txRef) {
    const { data: tx, error: txError } = await userClient
      .from("transactions")
      .select("id")
      .eq("reference", txRef)
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (!txError && tx) return true;
  }

  return false;
}

async function processDeposit(
  supabaseAdmin: SupabaseClient,
  txRef: string,
  amountRaw: unknown,
  meta: Record<string, unknown> | undefined,
) {
  const amount = Math.max(0, asPositiveInt(amountRaw, 0));
  const fallbackEmail = String(meta?.buyerEmail ?? "").trim().toLowerCase();
  let primaryDepositLookup = await supabaseAdmin
    .from("transactions")
    .select("id, user_id, amount, status, balance_credited")
    .eq("reference", txRef)
    .eq("type", "deposit")
    .maybeSingle();
  let txMissingBalanceCreditedColumn = false;
  if (primaryDepositLookup.error && isMissingColumnError(primaryDepositLookup.error, "balance_credited")) {
    txMissingBalanceCreditedColumn = true;
    const fallbackDepositLookup = await supabaseAdmin
      .from("transactions")
      .select("id, user_id, amount, status")
      .eq("reference", txRef)
      .eq("type", "deposit")
      .maybeSingle();
    if (fallbackDepositLookup.error) {
      return { ok: false, status: 500, error: `Failed deposit lookup: ${formatDbError(fallbackDepositLookup.error)}` };
    }
    // @ts-ignore -- pre-existing mixed select shape in fallback assignment
    primaryDepositLookup = {
      // @ts-ignore -- fallback row omits balance_credited column
      data: fallbackDepositLookup.data,
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    };
  }
  if (primaryDepositLookup.error) {
    return { ok: false, status: 500, error: `Failed deposit lookup: ${formatDbError(primaryDepositLookup.error)}` };
  }
  let tx = primaryDepositLookup.data as {
    id: string;
    user_id: string;
    amount: number;
    status: string;
    balance_credited?: boolean | null;
  } | null;
  if (!tx && fallbackEmail) {
    const profileByEmail = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", fallbackEmail)
      .maybeSingle();
    if (!profileByEmail.error && profileByEmail.data?.id) {
      const fallbackTxLookup = await supabaseAdmin
        .from("transactions")
        .select(txMissingBalanceCreditedColumn ? "id, user_id, amount, status" : "id, user_id, amount, status, balance_credited")
        .eq("user_id", profileByEmail.data.id)
        .eq("type", "deposit")
        .in("status", ["pending", "initiated"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (!fallbackTxLookup.error && Array.isArray(fallbackTxLookup.data) && fallbackTxLookup.data.length > 0) {
        // @ts-ignore -- pre-existing parser/type narrowing mismatch on fallback row cast
        tx = fallbackTxLookup.data[0] as {
          id: string;
          user_id: string;
          amount: number;
          status: string;
          balance_credited?: boolean | null;
        };
      }
    }
  }

  if (tx?.status) {
    console.log(`Processing transaction ${txRef}. Current status: ${tx.status}`);
  }

  if (tx?.balance_credited === true) {
    return { ok: true, status: 200, data: { ok: true, message: "Transaction already processed", idempotent: true, alreadyCredited: true } };
  }

  const normalizedStatus = normalize(tx?.status);
  if (normalizedStatus === "completed" || normalizedStatus === "finalized" || normalizedStatus === "success") {
    return { ok: true, status: 200, data: { ok: true, message: "Transaction already processed", idempotent: true } };
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

  if (tx?.id) {
    const lockTx = await supabaseAdmin
      .from("transactions")
      .update({ status: "completed", amount: credit })
      .eq("id", tx.id)
      .in("status", ["pending", "initiated"])
      .select("id")
      .maybeSingle();
    if (lockTx.error) {
      return { ok: false, status: 500, error: `Deposit completion lock failed: ${formatDbError(lockTx.error)}` };
    }
    if (!lockTx.data) {
      return { ok: true, status: 200, data: { ok: true, message: "Transaction already processed", idempotent: true } };
    }
  }

  if (tx?.id) {
    const updatePayload: Record<string, unknown> = { amount: credit };
    if (!txMissingBalanceCreditedColumn) {
      updatePayload.balance_credited = true;
    }
    const txUpdateAttempt = await supabaseAdmin
      .from("transactions")
      .update(updatePayload)
      .eq("id", tx.id);
    if (txUpdateAttempt.error && !isMissingColumnError(txUpdateAttempt.error, "balance_credited")) {
      return { ok: false, status: 500, error: `Deposit completion failed: ${formatDbError(txUpdateAttempt.error)}` };
    }
    if (txUpdateAttempt.error && isMissingColumnError(txUpdateAttempt.error, "balance_credited")) {
      const fallbackTxUpdate = await supabaseAdmin
        .from("transactions")
        .update({ amount: credit })
        .eq("id", tx.id);
      if (fallbackTxUpdate.error) {
        return { ok: false, status: 500, error: `Deposit completion failed: ${formatDbError(fallbackTxUpdate.error)}` };
      }
    }
  } else {
    const createdFallback = await supabaseAdmin
      .from("transactions")
      .insert({
        user_id: userId,
        amount: credit,
        type: "deposit",
        status: "completed",
        reference: txRef,
        balance_credited: true,
      })
      .select("id")
      .maybeSingle();
    if (createdFallback.error && !isMissingColumnError(createdFallback.error, "balance_credited")) {
      // Non-fatal for balance update, but log for reconciliation.
      console.error("[FlutterwaveWebhook] Could not create fallback deposit transaction row", {
        txRef,
        userId,
        error: formatDbError(createdFallback.error),
      });
    }
    if (createdFallback.error && isMissingColumnError(createdFallback.error, "balance_credited")) {
      const legacyFallback = await supabaseAdmin
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
      if (legacyFallback.error) {
        console.error("[FlutterwaveWebhook] Could not create fallback deposit transaction row", {
          txRef,
          userId,
          error: formatDbError(legacyFallback.error),
        });
      }
    }
  }

  return { ok: true, status: 200, data: { ok: true, userId, reference: txRef } };
}

async function completeSuccessfulTxRefPayment(
  supabaseService: SupabaseClient,
  tx_ref: string,
  amountRaw: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const amount = Math.max(0, asPositiveInt(amountRaw, 0));
  if (!tx_ref || amount <= 0) {
    return { ok: false, status: 400, error: "Missing tx_ref or amount in webhook data payload." };
  }

  const existingTx = await supabaseService
    .from("transactions")
    .select("id, user_id, status, balance_credited, type")
    .eq("reference", tx_ref)
    .maybeSingle();

  if (existingTx.error) {
    return {
      ok: false,
      status: 500,
      error: `tx_ref lookup failed: ${formatDbError(existingTx.error)}`,
    };
  }

  if (!existingTx.data) {
    // If no transaction exists yet, we'll let processDeposit handle creating it.
    return { ok: true };
  }

  const currentStatus = normalize(String(existingTx.data.status ?? ""));
  console.log(`Processing transaction ${tx_ref}. Current status: ${currentStatus}`);

  const txType = normalize(String(existingTx.data.type ?? ""));
  if (txType !== "deposit" && txType !== "wallet_topup") {
    console.log(`Transaction ${tx_ref} is type ${txType}. Deferring completion to processSuccessfulTransaction.`);
    return { ok: true };
  }

  // 1. Check Idempotency: If already completed or credited, return success immediately.
  if (currentStatus === "completed" || existingTx.data.balance_credited === true) {
    console.log(`Transaction ${tx_ref} already completed/credited. Skipping.`);
    return { ok: true };
  }

  // 2. Atomic Update: Only update if status is still pending/initiated.
  // This update will fire the database trigger 'trg_apply_wallet_credit_from_transaction',
  // which will handle the balance increment atomically.
  const txUpdate = await supabaseService
    .from("transactions")
    .update({ 
      status: "completed",
      amount: amount // Ensure amount is recorded correctly
    })
    .eq("reference", tx_ref)
    .in("status", ["pending", "initiated"])
    .select("id, user_id")
    .maybeSingle();

  if (txUpdate.error) {
    return {
      ok: false,
      status: 500,
      error: `tx_ref completion update failed: ${formatDbError(txUpdate.error)}`,
    };
  }

  // If no rows were updated, it means it was already moved out of pending status by a race condition.
  if (!txUpdate.data) {
    return { ok: true };
  }

  // NOTE: We have REMOVED the 'increment_balance' RPC call here.
  // The database trigger handles the balance update when the status changes to 'completed'.

  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, verif-hash, x-admin-bypass");
  console.log("All Headers:", req.headers);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  const userAgentHeader = req.headers["user-agent"];
  const userAgent = Array.isArray(userAgentHeader) ? String(userAgentHeader[0] ?? "") : String(userAgentHeader ?? "");
  if (userAgent.includes("Mozilla")) {
    res.status(200).json({ message: "Frontend ping ignored" });
    return;
  }
  if (!req.body) {
    res.status(400).json({ error: "No data" });
    return;
  }

  try {
    console.log("Full Webhook Body:", JSON.stringify(req.body, null, 2));
    const rawBody = (req.body ?? {}) as FlutterwaveEvent;
    const payload = (
      rawBody?.data && typeof rawBody.data === "object"
        ? (rawBody.data as Record<string, unknown>)
        : (rawBody as Record<string, unknown>)
    );
    if (!payload || Object.keys(payload).length === 0) {
      res.status(400).json({ error: "No data" });
      return;
    }
    const dataStatus = String(payload.status ?? rawBody.status ?? "").trim();
    const txRef = String(payload.tx_ref ?? rawBody.tx_ref ?? "").trim();
    if (!txRef) {
      res.status(400).json({ error: "Missing tx_ref." });
      return;
    }

    const bypassAllowed = await canUseAdminBypass(req, txRef);
    const webhookHash = process.env.FLW_WEBHOOK_HASH;
    let signature = "";
    try {
      signature =
        headerValueCaseInsensitive(req.headers, "verif-hash")
        || headerValueCaseInsensitive(req.headers, "verif_hash")
        || headerValueCaseInsensitive(req.headers, "X-Flutterwave-Signature");
      console.log("Received Hash:", signature, "Expected:", webhookHash);
    } catch (signatureError) {
      console.error("[FlutterwaveWebhook] Signature extraction failed", signatureError);
      if (!bypassAllowed) {
        res.status(401).json({ error: "Invalid Flutterwave webhook signature." });
        return;
      }
    }

    if (!bypassAllowed && (!webhookHash || signature !== webhookHash)) {
      console.error("HASH_MISMATCH: Check your Vercel Env Variables");
      res.status(401).json({ error: "Invalid Flutterwave webhook signature." });
      return;
    }

    const dataAmountRaw = payload.amount ?? 0;
    const dataAmount = Math.max(0, asPositiveInt(dataAmountRaw, 0));
    const event = normalize(String(rawBody.event ?? payload.event ?? ""));
    const status = normalize(dataStatus);

    if (!(event === "charge.completed" || event === "payment.success" || isSuccessfulGatewayStatus(status))) {
      res.status(200).json({ ok: true, ignored: true, event: rawBody.event ?? null, status });
      return;
    }
    if (!isSuccessfulGatewayStatus(status)) {
      res.status(200).json({ ok: true, ignored: true, event: rawBody.event ?? null, status });
      return;
    }

    let supabaseService: SupabaseClient;
    try {
      supabaseService = getSupabaseServiceClient();
    } catch (error) {
      res.status(500).json({ error: `Server misconfigured: ${String(error)}` });
      return;
    }

    const directCompletion = await completeSuccessfulTxRefPayment(supabaseService, txRef, dataAmount);
    if (!directCompletion.ok) {
      const err = directCompletion as { ok: false; status: number; error: string };
      res.status(err.status).json({ error: err.error });
      return;
    }

    let processSuccessfulTransactionFn: ProcessSuccessfulTransactionFn;
    try {
      processSuccessfulTransactionFn = await loadProcessSuccessfulTransaction();
    } catch (error) {
      console.error("[FlutterwaveWebhook] Failed to load processSuccessfulOrder helper", error);
      res.status(500).json({ error: "Webhook helper module missing or invalid." });
      return;
    }

    const { data: tx, error: txLookupError } = await supabaseService
      .from("transactions")
      .select("*")
      .eq("reference", txRef)
      .maybeSingle();
    if (txLookupError) {
      const lookupMessage = String(txLookupError.message ?? "").toLowerCase();
      if (lookupMessage.includes("no rows")) {
        res.status(200).json({ message: "Transaction not found, skipping" });
        return;
      }
      res.status(500).json({ error: `Transaction lookup failed: ${formatDbError(txLookupError)}` });
      return;
    }

    if (tx) {
      const currentStatus = normalize(tx.status);
      if (currentStatus === "completed" || tx.balance_credited === true) {
        console.log(`[FlutterwaveWebhook] Transaction ${txRef} already processed/credited. STOP.`);
        res.status(200).json({ ok: true, message: "Transaction already processed", idempotent: true });
        return;
      }
    }

    const mergedMeta = {
      ...((rawBody.meta ?? {}) as Record<string, unknown>),
      ...((rawBody.metadata ?? {}) as Record<string, unknown>),
      ...((payload.meta ?? {}) as Record<string, unknown>),
      ...((payload.metadata ?? {}) as Record<string, unknown>),
    } as Record<string, unknown>;
    const metaType = String(mergedMeta.type ?? "").trim().toLowerCase();
    const isWalletTopupMeta = metaType === "wallet_topup" || metaType === "deposit";
    console.log("[FlutterwaveWebhook] tx_ref verification", {
      tx_ref: txRef,
      matched_transaction_type: tx?.type ?? null,
      wallet_topup_meta: isWalletTopupMeta,
      tx_found: Boolean(tx?.id),
    });

    if (!bypassAllowed) {
      const verified = await verifyFlutterwaveByReference(txRef);
      if (!verified.ok) {
        const vErr = verified as { ok: false; error: string; status?: number };
        await writeVerificationAudit(supabaseService, {
          txRef,
          decision: "rejected",
          reason: vErr.error,
          expectedAmount: Math.max(0, asPositiveInt(tx?.amount ?? dataAmount, 0)),
          payload,
        });
        res.status(vErr.status ?? 502).json({ error: vErr.error });
        return;
      }
      const expectedAmount = Math.max(0, asPositiveInt(tx?.amount ?? dataAmount, 0));
      if (expectedAmount > 0 && verified.amount > 0 && verified.amount !== expectedAmount) {
        await writeVerificationAudit(supabaseService, {
          txRef,
          decision: "rejected",
          reason: `Flutterwave amount mismatch. expected=${expectedAmount}, verified=${verified.amount}`,
          expectedAmount,
          verifiedAmount: verified.amount,
          payload,
        });
        res.status(409).json({
          error: `Flutterwave amount mismatch. expected=${expectedAmount}, verified=${verified.amount}`,
        });
        return;
      }

      await writeVerificationAudit(supabaseService, {
        txRef,
        decision: "accepted",
        reason: "verify_by_reference successful",
        expectedAmount,
        verifiedAmount: verified.amount,
        payload,
      });
    }

    const txType = String(tx?.type ?? "").trim().toLowerCase();
    const isDepositType = txType === "deposit" || txType === "wallet_topup";
    const result = isDepositType || (!tx?.id && isWalletTopupMeta)
      ? await processDeposit(
        supabaseService,
        txRef,
        dataAmount,
        {
          ...(typeof payload.meta === 'object' && payload.meta !== null ? payload.meta : {}),
          ...(typeof payload.metadata === 'object' && payload.metadata !== null ? payload.metadata : {}),
          ...(typeof rawBody.meta === 'object' && rawBody.meta !== null ? (rawBody.meta as Record<string, unknown>) : {}),
          ...(typeof rawBody.metadata === 'object' && rawBody.metadata !== null ? (rawBody.metadata as Record<string, unknown>) : {}),
          buyerEmail:
            (payload.customer as { email?: string } | undefined)?.email
            ?? (payload.meta as Record<string, unknown> | undefined)?.buyerEmail
            ?? (payload.metadata as Record<string, unknown> | undefined)?.buyerEmail
            ?? (payload.meta as Record<string, unknown> | undefined)?.buyerEmail
            ?? (payload.metadata as Record<string, unknown> | undefined)?.buyerEmail,
        },
      )
      : tx?.id
        ? await processSuccessfulTransactionFn(supabaseService, tx.id, dataAmount)
        : { ok: false, status: 404, error: "No transaction found for tx_ref." };

    if (!result.ok) {
      res.status(result.status).json({ error: result.error ?? "Webhook processing failed." });
      return;
    }

    res.status(result.status).json(result.data ?? { ok: true });
  } catch (error) {
    console.error("[FlutterwaveWebhook] Unhandled error", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
}
