/**
 * Elon Marketplace — Paystack Webhook Handler
 * Legacy function slug kept as `pocketfi-webhook` for backward compatibility.
 *
 * Secrets: PAYSTACK_SECRET_KEY (same sk_… secret as pocketfi-init)
 * Auto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Verifies `x-paystack-signature` (HMAC-SHA512 of raw body).
 * On charge.success: completes wallet deposits (process_deposit) or fulfills purchases (fulfill_paystack_purchase).
 * Always responds 200 OK so Paystack stops retrying (errors are logged server-side).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

function ok(body: Record<string, unknown> = { received: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = a.toLowerCase();
  const bb = b.toLowerCase().trim();
  if (aa.length !== bb.length) return false;
  let mismatch = 0;
  for (let i = 0; i < aa.length; i++) {
    mismatch |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string,
  secretKey: string,
): Promise<boolean> {
  if (!signatureHeader?.trim() || !secretKey) return false;
  try {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secretKey),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(rawBody),
    );
    const computedHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return timingSafeEqualHex(computedHex, signatureHeader);
  } catch (e) {
    console.error("[legacy-paystack-webhook] signature compute error:", e);
    return false;
  }
}

function normalizePaystackSecret(raw: string): string {
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

interface PaystackChargeData {
  reference?: string;
  amount?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

interface PaystackWebhookPayload {
  event?: string;
  data?: PaystackChargeData;
}

function koboToNaira(kobo: number): number {
  if (!Number.isFinite(kobo) || kobo <= 0) return 0;
  return Math.floor(kobo / 100);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return ok({ received: true, ignored: true, reason: "method" });
  }

  const rawBody = await req.text();

  const sig =
    req.headers.get("x-paystack-signature") ??
    req.headers.get("X-Paystack-Signature") ??
    "";

  const rawSecret = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
  const paystackSecret = normalizePaystackSecret(rawSecret);

  if (!paystackSecret) {
    console.error("[legacy-paystack-webhook] PAYSTACK_SECRET_KEY not set.");
    return ok({ received: true, error: "misconfigured" });
  }

  const valid = await verifyPaystackSignature(rawBody, sig, paystackSecret);
  if (!valid) {
    console.warn("[legacy-paystack-webhook] Invalid x-paystack-signature (logged, still 200).");
    return ok({ received: true, verified: false });
  }

  let payload: PaystackWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PaystackWebhookPayload;
  } catch {
    console.warn("[legacy-paystack-webhook] Invalid JSON body.");
    return ok({ received: true, parse_error: true });
  }

  const event = String(payload.event ?? "").toLowerCase();
  if (event !== "charge.success") {
    console.log(`[legacy-paystack-webhook] Ignoring event: ${event}`);
    return ok({ received: true, ignored: true, event });
  }

  const data = payload.data ?? {};
  const reference = String(data.reference ?? "").trim();
  const status = String(data.status ?? "").toLowerCase();
  const rawAmount = Number(data.amount ?? 0);

  if (status && status !== "success") {
    console.log(`[legacy-paystack-webhook] charge.success but status=${status} ref=${reference}`);
    return ok({ received: true, ignored: true, status });
  }

  if (!reference) {
    console.warn("[legacy-paystack-webhook] charge.success missing reference.");
    return ok({ received: true, missing_reference: true });
  }

  const amountNaira = koboToNaira(rawAmount);
  if (amountNaira <= 0) {
    console.warn(`[legacy-paystack-webhook] Invalid amount kobo=${rawAmount} ref=${reference}`);
    return ok({ received: true, invalid_amount: true });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[legacy-paystack-webhook] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    return ok({ received: true, error: "server_config" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: depositResult, error: depositErr } = await supabase.rpc("process_deposit", {
    p_reference: reference,
    p_amount_naira: amountNaira,
  });

  if (depositErr) {
    console.error("[legacy-paystack-webhook] process_deposit RPC error:", depositErr.message);
  } else if (depositResult?.success) {
    console.log(
      `[legacy-paystack-webhook] Deposit completed ref=${reference} amount=₦${amountNaira}` +
        (depositResult.idempotent ? " (idempotent)" : ""),
    );
    return ok({ received: true, processed: true, kind: "deposit" });
  } else if (depositResult && !depositResult.success) {
    const dMsg = String(depositResult.message ?? "");
    if (dMsg !== "Reference not found.") {
      console.error(`[legacy-paystack-webhook] process_deposit failed ref=${reference}:`, dMsg);
      return ok({ received: true, deposit_failed: true });
    }
    // Reference not found on a deposit row — try Paystack purchase fulfillment.
  }

  const { data: purchaseResult, error: purchaseErr } = await supabase.rpc(
    "fulfill_paystack_purchase",
    {
      p_reference: reference,
      p_amount_naira: amountNaira,
    },
  );

  if (purchaseErr) {
    console.error("[legacy-paystack-webhook] fulfill_paystack_purchase RPC error:", purchaseErr.message);
    return ok({ received: true, purchase_rpc_error: true });
  }

  if (purchaseResult?.success) {
    console.log(
      `[legacy-paystack-webhook] Purchase fulfilled ref=${reference} amount=₦${amountNaira}` +
        (purchaseResult.idempotent ? " (idempotent)" : ""),
    );
    return ok({ received: true, processed: true, kind: "purchase" });
  }

  const msg = purchaseResult?.message ?? depositResult?.message ?? "unknown";
  console.warn(
    `[legacy-paystack-webhook] No matching pending transaction ref=${reference} last_msg=${msg}`,
  );
  return ok({ received: true, not_found: true });
});
