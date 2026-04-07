import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Elon Marketplace — PocketFi Payment Initializer
 * Supabase Edge Function (Deno runtime)
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   POCKETFI_SECRET_KEY   — required. Secret / API key from PocketFi.
 *   POCKETFI_INIT_URL     — strongly recommended: exact POST URL PocketFi gave you
 *                           (full https://...). If unset, we guess common paths (often 404).
 */

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

function extractCheckoutUrl(j: Record<string, unknown>): string | undefined {
  const data = (j?.data ?? {}) as Record<string, unknown>;
  return (
    (data.authorization_url as string | undefined) ??
    (data.checkout_url as string | undefined) ??
    (data.payment_url as string | undefined) ??
    (data.link as string | undefined) ??
    (data.url as string | undefined) ??
    (j.authorization_url as string | undefined) ??
    (j.checkout_url as string | undefined) ??
    (j.payment_url as string | undefined)
  );
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized: missing session token." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[pocketfi-init] SUPABASE_URL or SUPABASE_ANON_KEY missing.");
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

    const secretKey = Deno.env.get("POCKETFI_SECRET_KEY");
    if (!secretKey) {
      console.error("[pocketfi-init] POCKETFI_SECRET_KEY not set.");
      return json({ error: "Payment gateway not configured. Contact support." }, 500);
    }

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

    const payload = {
      amount: amountNumber,
      email: authedUser.email ?? String(email),
      reference: String(reference),
      callback_url: String(callbackUrl),
    };

    console.log("[pocketfi-init] PocketFi payload →", { ...payload, secretKey: "[REDACTED]" });

    const initUrlOverride = Deno.env.get("POCKETFI_INIT_URL")?.trim();

    // When merchant sets POCKETFI_INIT_URL, ONLY hit that URL (no long fallback list).
    const defaultEndpoints = [
      "https://api.pocketfi.ng/v1/transaction/initialize",
      "https://api.pocketfi.ng/v1/transactions/initialize",
      "https://api.pocketfi.ng/v1/payment/initialize",
      "https://api.pocketfi.ng/v1/payments/initialize",
      "https://api.pocketfi.ng/v1/pay/initialize",
      "https://api.pocketfi.ng/transaction/initialize",
      "https://api.pocketfi.ng/transactions/initialize",
      "https://api.pocketfi.ng/api/v1/transaction/initialize",
      "https://api.pocketfi.ng/api/v1/transactions/initialize",
      "https://pocketfi.ng/api/v1/transaction/initialize",
      "https://pocketfi.ng/api/v1/transactions/initialize",
    ];

    const candidateEndpoints = initUrlOverride
      ? [initUrlOverride]
      : [...new Set(defaultEndpoints)];

    if (initUrlOverride) {
      console.log("[pocketfi-init] Using only POCKETFI_INIT_URL:", initUrlOverride);
    }

    const candidatePayloads = [
      payload,
      { ...payload, callbackUrl: payload.callback_url },
      {
        amount: payload.amount,
        email: payload.email,
        reference: payload.reference,
        redirect_url: payload.callback_url,
      },
      {
        amount: payload.amount,
        email: payload.email,
        reference: payload.reference,
        callbackUrl: payload.callback_url,
      },
    ];

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

    let lastNetworkError = "";
    let lastNon404Error = "";
    let saw404Only = true;
    let saw404OnOverride = false;

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
            console.log(`[pocketfi-init] ${endpoint} [${name}] -> ${res.status}:`, txt.slice(0, 800));

            if (res.status === 404) {
              if (initUrlOverride && endpoint === initUrlOverride) saw404OnOverride = true;
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
                console.log("[pocketfi-init] ✓ checkout URL via", name);
                return json({ checkoutUrl, checkout_url: checkoutUrl });
              }
              console.error("[pocketfi-init] OK but no checkout URL:", pocketFiJson);
              return json({
                error: "PocketFi did not return a checkout URL in the response.",
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

    if (initUrlOverride && saw404OnOverride && saw404Only) {
      return json({
        error:
          "POCKETFI_INIT_URL returned 404 (not found). In Supabase → Edge Functions → Secrets, " +
            "paste the exact initialize POST URL from PocketFi (copy from their email or dashboard). " +
            "Redeploy after changing secrets: npx supabase functions deploy pocketfi-init",
        hint: `Configured host/path: ${initUrlOverride.replace(/\/[^/]*$/, "/…")}`,
      }, 502);
    }

    if (saw404Only) {
      return json({
        error:
          "PocketFi returned 404 for every guessed route. Set secret POCKETFI_INIT_URL to the full POST URL " +
          "from PocketFi, then redeploy this function.",
      }, 502);
    }

    return json({
      error:
        "PocketFi rejected credentials or returned an error. Check POCKETFI_SECRET_KEY and Edge Function logs. " +
        `Detail: ${lastNon404Error || "unknown"}`,
    }, 502);
  } catch (e) {
    console.error("[pocketfi-init] unhandled:", e);
    return json(
      { error: "pocketfi-init crashed.", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
