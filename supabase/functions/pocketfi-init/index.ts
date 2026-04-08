import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Elon Marketplace — PocketFi Payment Initializer
 * Supabase Edge Function (Deno runtime)
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   POCKETFI_SECRET_KEY   — required. Secret key from PocketFi settings.
 *   POCKETFI_API_KEY      — required. Exact API key value from PocketFi dashboard.
 *   POCKETFI_INIT_URL     — strongly recommended: exact POST URL PocketFi gave you
 *                           (full https://...). We call this URL only.
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
    (data.checkout_url as string | undefined) ??
    (j.checkout_url as string | undefined)
  );
}

/** Parse JSON even when the gateway wraps it (BOM, whitespace, HTML around JSON). */
function tryParseLenientJson(txt: string): Record<string, unknown> | null {
  const trimmed = txt.replace(/^\uFEFF/, "").trim();
  try {
    return trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : {};
  } catch {
    /* fall through */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>\\)]+/gi;
const FETCH_TIMEOUT_MS = 30000;
const MAX_TOTAL_ATTEMPTS = 3;

function redactHeaderMeta(headers: Record<string, string>) {
  const auth = headers.Authorization ?? "";
  const xApiKey = headers["X-Api-Key"] ?? headers["x-api-key"] ?? "";
  return {
    hasAuthorization: Boolean(auth),
    authLooksBearer: /^Bearer\s+/i.test(auth),
    authorizationLength: auth.length,
    hasXApiKey: Boolean(xApiKey),
    xApiKeyLength: xApiKey.length,
    hasXSecretKey: Boolean(headers["x-secret-key"]),
    xSecretKeyLength: (headers["x-secret-key"] ?? "").length,
  };
}

/** When PocketFi returns 200 with HTML or plain text, pull the first plausible payment URL. */
function extractCheckoutUrlFromRawBody(txt: string): string | undefined {
  const candidates = txt.match(URL_IN_TEXT_RE) ?? [];
  const score = (u: string) => {
    const lower = u.toLowerCase();
    let s = 0;
    if (/pocketfi|paystack|flutterwave|monnify|checkout|authorize|payment|gateway|transaction/i.test(lower)) s += 5;
    if (/\.(html?|php)(\?|$)/i.test(lower)) s += 2;
    if (/^https:\/\//i.test(u)) s += 1;
    return s;
  };
  const cleaned = candidates.map((u) => u.replace(/[,;.]+$/g, ""));
  cleaned.sort((a, b) => score(b) - score(a));
  const best = cleaned.find((u) => /^https?:\/\//i.test(u));
  return best;
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

    const apiKey = Deno.env.get("POCKETFI_API_KEY")?.trim();

    let body: { amount: unknown; email: unknown; reference: unknown; callbackUrl?: unknown; callback_url?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { amount, email, reference } = body;
    const callbackUrl = body.callback_url ?? body.callbackUrl;

    if (!amount || !email || !reference || !callbackUrl) {
      return json({ error: "Missing required fields: amount, email, reference, callback_url." }, 400);
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

    const initUrlRaw = Deno.env.get("POCKETFI_INIT_URL")?.trim();
    if (!initUrlRaw) {
      return json({
        error: "POCKETFI_INIT_URL is required. Set the exact PocketFi v2 initialization URL in secrets.",
      }, 500);
    }
    const initUrlOverride = initUrlRaw.replace(/\/+$/, "");
    const candidateEndpoints = [initUrlOverride];
    console.log("[pocketfi-init] Using strict normalized POCKETFI_INIT_URL only:", initUrlOverride);

    // PocketFi v2 payload standard.
    const candidatePayloads = [payload];

    const baseHeaders = { "Content-Type": "application/json" };
    if (!apiKey) {
      return json({
        error:
          "POCKETFI_API_KEY is missing. Set the full API key exactly as shown in dashboard (including pipe '|').",
      }, 500);
    }

    // Strict required strategy only:
    // Authorization: Bearer <POCKETFI_SECRET_KEY>
    // X-Api-Key: <POCKETFI_API_KEY>
    const authStrategies: { name: string; headers: Record<string, string> }[] = [{
      name: "Bearer secret + x-api-key (strict)",
      headers: { ...baseHeaders, Authorization: `Bearer ${secretKey}`, "X-Api-Key": apiKey },
    }];

    let lastNetworkError = "";
    let lastNon404Error = "";
    let saw404Only = true;
    let attempts = 0;

    for (const endpoint of candidateEndpoints) {
      for (const { name, headers } of authStrategies) {
        for (const bodyCandidate of candidatePayloads) {
          if (attempts >= MAX_TOTAL_ATTEMPTS) {
            return json({
              error:
                "PocketFi init timed out while trying prioritized auth/path combinations. " +
                "Set the exact POCKETFI_INIT_URL and verify POCKETFI_API_KEY + POCKETFI_SECRET_KEY.",
            }, 504);
          }
          attempts += 1;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
          try {
            console.log("[pocketfi-init] Attempting URL:", endpoint);
            console.log("[pocketfi-init] Header meta:", {
              strategy: name,
              ...redactHeaderMeta(headers),
            });
            const res = await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify(bodyCandidate),
              signal: controller.signal,
            });
            const txt = await res.text();
            console.log(`[pocketfi-init] ${endpoint} [${name}] -> ${res.status}:`, txt.slice(0, 800));

            if (res.status === 404) {
              console.log("[pocketfi-init] 404 full response body:", txt);
              continue;
            }
            saw404Only = false;

            const pocketFiJson = txt ? tryParseLenientJson(txt) : {};

            if (!pocketFiJson) {
              if (res.ok) {
                const fromRaw = extractCheckoutUrlFromRawBody(txt);
                if (fromRaw) {
                  console.log("[pocketfi-init] ✓ checkout URL from non-JSON body via", name);
                  return json({ checkoutUrl: fromRaw, checkout_url: fromRaw });
                }
                console.error("[pocketfi-init] OK but body not JSON and no URL found; sample:", txt.slice(0, 400));
                return json({
                  error:
                    "PocketFi returned a non-JSON success response without a recognizable payment URL. " +
                      "Confirm POCKETFI_INIT_URL matches their docs and set POCKETFI_API_KEY if the dashboard lists a separate API key.",
                }, 502);
              }
              lastNon404Error = txt.slice(0, 500);
              continue;
            }

            if (res.ok) {
              let checkoutUrl = extractCheckoutUrl(pocketFiJson);
              if (!checkoutUrl && txt) {
                checkoutUrl = extractCheckoutUrlFromRawBody(txt);
              }
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
            return json({
              error: `PocketFi error (${res.status}): ${errMsg}`,
              upstream_status: res.status,
              upstream_raw: txt.slice(0, 2000),
            }, 502);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/aborted|timeout/i.test(message)) {
              lastNetworkError = `Timed out after ${FETCH_TIMEOUT_MS}ms`;
            } else {
              lastNetworkError = message;
            }
            console.error(`[pocketfi-init] Fetch failed before response from ${endpoint}:`, {
              strategy: name,
              error: lastNetworkError,
              raw: err instanceof Error ? err.stack ?? err.message : String(err),
            });
          } finally {
            clearTimeout(timeoutId);
          }
        }
      }
    }

    if (lastNetworkError) {
      return json({
        error: `Network error reaching PocketFi: ${lastNetworkError}`,
        upstream_hint: "No response body received from PocketFi before failure.",
      }, 502);
    }

    if (saw404Only) {
      return json({
        error:
          "PocketFi returned 404 at POCKETFI_INIT_URL. Confirm the exact live v2 endpoint with PocketFi support and update POCKETFI_INIT_URL.",
        hint: initUrlOverride
          ? `Your secret starts with: ${initUrlOverride.slice(0, 48)}…`
          : undefined,
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
