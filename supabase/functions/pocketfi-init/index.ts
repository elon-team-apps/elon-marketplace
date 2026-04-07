import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
// Gateway JWT verification is disabled in supabase/config.toml for this function;
// we validate the caller with auth.getUser() below (same project JWT).
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

  // ── Validate signed-in user (gateway verify_jwt is off; we check JWT here) ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized: missing session token." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[pocketfi-init] SUPABASE_URL or SUPABASE_ANON_KEY missing in function env.");
    return json({ error: "Server configuration error." }, 500);
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await supabaseAuth.auth.getUser();
  if (authErr || !authData.user) {
    console.error("[pocketfi-init] auth.getUser failed:", authErr?.message);
    return json({ error: authErr?.message ?? "Invalid or expired session." }, 401);
  }
  const authedUser = authData.user;

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

  const requestedEmail = String(email).trim().toLowerCase();
  const sessionEmail = authedUser.email?.trim().toLowerCase() ?? "";
  if (!sessionEmail || requestedEmail !== sessionEmail) {
    return json({ error: "Email must match the signed-in account." }, 403);
  }

  // ── Call PocketFi server-side (no CORS issues here) ───────────────────────
  const payload = {
    amount:       amountNumber,     // PocketFi expects Naira, not kobo
    email:        authedUser.email ?? String(email),
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

  // PocketFi may reject `Bearer <secret>` with "Invalid JWT" if the key is not a JWT.
  // Try several header combinations (dashboard keys differ: API key vs secret vs token).
  const authStrategies: { name: string; headers: Record<string, string> }[] = [
    { name: "x-api-key only", headers: { "Content-Type": "application/json", "x-api-key": secretKey } },
    {
      name: "Bearer + x-api-key",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secretKey}`,
        "x-api-key": secretKey,
      },
    },
    {
      name: "Bearer only",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secretKey}` },
    },
    {
      name: "Authorization raw (no Bearer)",
      headers: { "Content-Type": "application/json", "Authorization": secretKey },
    },
  ];

  const extractCheckoutUrl = (j: Record<string, unknown>): string | undefined => {
    const data = (j?.data ?? {}) as Record<string, unknown>;
    return (
      (data.authorization_url as string | undefined) ??
      (data.checkout_url as string | undefined) ??
      (data.payment_url as string | undefined) ??
      (data.url as string | undefined) ??
      (j.authorization_url as string | undefined) ??
      (j.checkout_url as string | undefined)
    );
  };

  let lastNetworkError = "";
  let lastNon404Error = "";
  let saw404Only = true;

  for (const endpoint of candidateEndpoints) {
    for (const bodyCandidate of candidatePayloads) {
      for (const { name, headers } of authStrategies) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyCandidate),
          });
          const txt = await res.text();
          console.log(`[pocketfi-init] ${endpoint} [${name}] -> ${res.status}:`, txt);

          if (res.status === 404) {
            continue;
          }
          saw404Only = false;

          let pocketFiJson: Record<string, unknown> = {};
          try {
            pocketFiJson = txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
          } catch {
            if (res.ok) {
              return json({ error: "PocketFi returned non-JSON success body." }, 502);
            }
            lastNon404Error = txt.slice(0, 500);
            continue;
          }

          if (res.ok) {
            const checkoutUrl = extractCheckoutUrl(pocketFiJson);
            if (checkoutUrl) {
              console.log("[pocketfi-init] ✓ Checkout URL obtained via", name, checkoutUrl);
              return json({ checkoutUrl, checkout_url: checkoutUrl });
            }
            console.error("[pocketfi-init] OK but no checkout URL:", pocketFiJson);
            return json({
              error: "PocketFi did not return a checkout URL. Check Edge Function logs.",
              raw: pocketFiJson,
            }, 502);
          }

          if (res.status === 401 || res.status === 403) {
            const errMsg = (pocketFiJson?.message ?? pocketFiJson?.error ?? txt) as string;
            console.warn(`[pocketfi-init] Auth rejected [${name}]:`, errMsg);
            lastNon404Error = errMsg || txt;
            continue;
          }

          const errMsg = (pocketFiJson?.message ?? pocketFiJson?.error ?? txt) as string;
          return json({ error: `PocketFi error (${res.status}): ${errMsg}` }, 502);
        } catch (err) {
          lastNetworkError = err instanceof Error ? err.message : String(err);
          console.error(`[pocketfi-init] Network error calling ${endpoint}:`, lastNetworkError);
        }
      }
    }
  }

  if (lastNetworkError) {
    return json({ error: `Network error reaching PocketFi: ${lastNetworkError}` }, 502);
  }
  if (saw404Only) {
    return json({ error: "PocketFi endpoint not found (404) on all known initialize routes." }, 502);
  }
  return json({
    error:
      "PocketFi rejected the configured secret (often shows as Invalid JWT). " +
      "In Supabase → Edge Functions → Secrets, set POCKETFI_SECRET_KEY to the exact Secret/API key from the PocketFi dashboard (not the public key). " +
      `Last message: ${lastNon404Error || "unknown"}`,
  }, 502);
});
