/**
 * Elon Marketplace — PocketFi Webhook Handler
 * Supabase Edge Function (Deno runtime)
 *
 * Webhook URL:
 *   https://mofhewplrepcitbwbexh.supabase.co/functions/v1/pocketfi-webhook
 *
 * Required Supabase Secrets (set via Dashboard → Edge Functions → Secrets):
 *   POCKETFI_SECRET_KEY    — your PocketFi secret key (rotated)
 *   SUPABASE_URL           — auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase runtime
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PocketFiWebhookPayload {
  event: string;
  data: {
    reference: string;
    amount: number;       // PocketFi sends amount in kobo (smallest unit)
    email: string;
    status: string;
    currency: string;
  };
}

// ─── Signature Verification ───────────────────────────────────────────────────

/**
 * Verifies the X-PocketFi-Signature header.
 * PocketFi uses HMAC-SHA512 of the raw request body, keyed with your Secret Key.
 * We use the Web Crypto API (available natively in Deno/Edge Functions) — no
 * third-party hashing library required.
 */
async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secretKey: string,
): Promise<boolean> {
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

    // Convert the computed signature to a lowercase hex string
    const computedHex = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Timing-safe comparison — prevents timing attacks on the signature check
    if (computedHex.length !== signatureHeader.length) return false;

    let mismatch = 0;
    for (let i = 0; i < computedHex.length; i++) {
      mismatch |= computedHex.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
    }

    return mismatch === 0;
  } catch {
    return false;
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Edge Functions only accept POST. Return 405 for anything else.
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── 1. Read the raw body BEFORE parsing JSON ──────────────────────────────
  // We must hash the raw body string, not a re-serialised object.
  const rawBody = await req.text();

  // ── 2. Verify the PocketFi signature ─────────────────────────────────────
  const signatureHeader = req.headers.get("X-PocketFi-Signature") ?? "";
  const pocketFiSecret = Deno.env.get("POCKETFI_SECRET_KEY") ?? "";

  if (!pocketFiSecret) {
    console.error("POCKETFI_SECRET_KEY secret is not set.");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const isValid = await verifySignature(rawBody, signatureHeader, pocketFiSecret);

  if (!isValid) {
    console.warn("Rejected webhook: invalid signature.");
    // Return 400, not 401 — don't hint that this is an auth boundary
    return new Response("Invalid signature", { status: 400 });
  }

  // ── 3. Parse and validate the payload ────────────────────────────────────
  let payload: PocketFiWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only handle the success event — silently acknowledge all others
  // so PocketFi stops retrying them.
  if (payload.event !== "transaction.success") {
    console.log(`Unhandled event type: ${payload.event} — acknowledged.`);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { reference, amount: amountKobo, status } = payload.data;

  if (!reference) {
    return new Response("Missing reference in payload", { status: 400 });
  }

  // Double-check the status field inside the payload as a second guard
  if (status !== "success") {
    console.log(`Payment reference ${reference} has status "${status}" — skipping.`);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 4. Convert amount: kobo → Naira (integer) ────────────────────────────
  // PocketFi sends amounts in kobo (smallest unit). ₦5,000 = 500000 kobo.
  // Our DB stores wallet_balance in whole Naira.
  const amountNaira = Math.floor(amountKobo / 100);

  if (amountNaira <= 0) {
    return new Response("Invalid amount in payload", { status: 400 });
  }

  // ── 5. Create service-role Supabase client ────────────────────────────────
  // We use the service role key here — it bypasses RLS so process_deposit()
  // can write to profiles and transactions freely.
  // These env vars are auto-injected by the Supabase runtime.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 6. Call the atomic process_deposit() Postgres function ────────────────
  const { data: result, error } = await supabase.rpc("process_deposit", {
    p_reference: reference,
    p_amount_naira: amountNaira,
  });

  if (error) {
    console.error("process_deposit() DB error:", error.message);
    // Return 500 so PocketFi retries the webhook delivery
    return new Response("Database error", { status: 500 });
  }

  if (!result?.success) {
    const msg = result?.message ?? "Unknown failure";
    console.error(`process_deposit() returned failure for ref ${reference}: ${msg}`);

    // If the reference simply wasn't found, that's a bad request (don't retry)
    if (msg === "Reference not found.") {
      return new Response("Reference not found", { status: 400 });
    }

    // For all other failures, return 500 so PocketFi retries
    return new Response("Processing failed", { status: 500 });
  }

  // ── 7. Acknowledge to PocketFi ────────────────────────────────────────────
  // PocketFi expects a 200 with any body. If we return anything else it
  // will retry the webhook up to its retry limit.
  console.log(
    `✓ Deposit processed — ref: ${reference}, ` +
    `amount: ₦${amountNaira}, user: ${result.user_id}` +
    (result.idempotent ? " (idempotent)" : ""),
  );

  return new Response(
    JSON.stringify({ received: true, processed: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
