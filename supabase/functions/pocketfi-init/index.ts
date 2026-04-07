/**
 * Elon Marketplace — PocketFi Payment Initializer
 * Supabase Edge Function (Deno runtime)
 *
 * Endpoint:
 *   https://mofhewplrepcitbwbexh.supabase.co/functions/v1/pocketfi-init
 *
 * Required Supabase Secret (Dashboard → Edge Functions → Secrets):
 *   POCKETFI_SECRET_KEY  — your PocketFi secret key
 *
 * Why a server-side function?
 *   - The browser cannot call api.pocketfi.ng directly (CORS policy).
 *   - The secret key must never be exposed in the client bundle.
 *   This function runs on Supabase's servers, calls PocketFi with the
 *   secret key, and returns only the checkout URL to the browser.
 */

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests from any origin (Vercel, localhost, etc.).
// Supabase still enforces JWT verification at the gateway: the browser must send
// apikey (anon) plus Authorization: Bearer <user access_token> from functions.invoke.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Handle CORS preflight — browsers send this before the real POST.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── Validate secret is configured ─────────────────────────────────────────
  const secretKey = Deno.env.get("POCKETFI_SECRET_KEY");
  if (!secretKey) {
    console.error("[pocketfi-init] POCKETFI_SECRET_KEY secret is not set in Supabase.");
    return json({ error: "Payment gateway not configured. Contact support." }, 500);
  }

  // ── Parse request body ─────────────────────────────────────────────────────
  let body: { amount: unknown; email: unknown; reference: unknown; callbackUrl: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { amount, email, reference, callbackUrl } = body;

  if (!amount || !email || !reference || !callbackUrl) {
    return json({ error: "Missing required fields: amount, email, reference, callbackUrl." }, 400);
  }

  const amountNumber = Number(amount);
  if (isNaN(amountNumber) || amountNumber <= 0) {
    return json({ error: "amount must be a positive number." }, 400);
  }

  // ── Call PocketFi server-side (no CORS issues here) ───────────────────────
  const payload = {
    amount:       amountNumber,     // PocketFi expects Naira, not kobo
    email:        String(email),
    reference:    String(reference),
    callback_url: String(callbackUrl),
  };

  console.log("[pocketfi-init] Sending to PocketFi →", { ...payload, secretKey: "[REDACTED]" });

  const candidateEndpoints = [
    "https://api.pocketfi.ng/v1/transaction/initialize",
    "https://api.pocketfi.ng/transaction/initialize",
    "https://api.pocketfi.ng/api/v1/transaction/initialize",
  ];
  const candidatePayloads = [
    payload,
    { ...payload, callbackUrl: payload.callback_url },
  ];

  let pocketFiRes: Response | null = null;
  let rawText = "";
  let lastNetworkError = "";

  for (const endpoint of candidateEndpoints) {
    for (const bodyCandidate of candidatePayloads) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${secretKey}`,
            "x-api-key": secretKey,
          },
          body: JSON.stringify(bodyCandidate),
        });

        const txt = await res.text();
        console.log(`[pocketfi-init] ${endpoint} -> ${res.status}:`, txt);

        // 404 means wrong route/signature; try the next endpoint variant.
        if (res.status === 404) continue;

        pocketFiRes = res;
        rawText = txt;
        break;
      } catch (err) {
        lastNetworkError = err instanceof Error ? err.message : String(err);
        console.error(`[pocketfi-init] Network error calling ${endpoint}:`, lastNetworkError);
      }
    }
    if (pocketFiRes) break;
  }

  if (!pocketFiRes) {
    if (lastNetworkError) {
      return json({ error: `Network error reaching PocketFi: ${lastNetworkError}` }, 502);
    }
    return json({ error: "PocketFi endpoint not found (404) on all known initialize routes." }, 502);
  }

  // Parse PocketFi response
  let pocketFiJson: Record<string, unknown>;
  try {
    pocketFiJson = JSON.parse(rawText);
  } catch {
    console.error("[pocketfi-init] PocketFi returned non-JSON:", rawText);
    return json({ error: `PocketFi returned unexpected response (status ${pocketFiRes.status}).` }, 502);
  }

  if (!pocketFiRes.ok) {
    const errMsg = (pocketFiJson?.message ?? pocketFiJson?.error ?? rawText) as string;
    return json({ error: `PocketFi error (${pocketFiRes.status}): ${errMsg}` }, 502);
  }

  // Extract checkout URL — try all known PocketFi field names
  const data = (pocketFiJson?.data ?? {}) as Record<string, unknown>;
  const checkoutUrl =
    (data.authorization_url as string | undefined) ??
    (data.checkout_url as string | undefined) ??
    (data.payment_url as string | undefined) ??
    (data.url as string | undefined) ??
    (pocketFiJson.authorization_url as string | undefined) ??
    (pocketFiJson.checkout_url as string | undefined);

  if (!checkoutUrl) {
    console.error("[pocketfi-init] No checkout URL in PocketFi response:", pocketFiJson);
    return json({
      error: "PocketFi did not return a checkout URL. Check Edge Function logs for the raw response.",
      raw: pocketFiJson,
    }, 502);
  }

  console.log("[pocketfi-init] ✓ Checkout URL obtained:", checkoutUrl);
  return json({ checkoutUrl });
});
