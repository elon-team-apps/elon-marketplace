import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Elon Marketplace — PocketFi Payment Initializer
 * Supabase Edge Function (Deno runtime)
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   POCKETFI_SECRET_KEY   — required. Sent raw in Authorization (no "Bearer" prefix) for PocketFi v1.
 *   POCKETFI_INIT_URL     — required. Exact POST URL from PocketFi docs.
 *   POCKETFI_BUSINESS_ID    — optional. Defaults to 29828 if unset.
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

const DEFAULT_BUSINESS_ID = "29828";
const DEFAULT_REDIRECT_URL = "https://elonmarketplace.com.ng/dashboard/payments";
const DEFAULT_DESCRIPTION = "Purchase from Elon Marketplace";

function extractPaymentLink(j: Record<string, unknown>): string | undefined {
  const data = (j?.data ?? {}) as Record<string, unknown>;
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : undefined;
  return (
    pick(j.payment_link) ??
    pick(data.payment_link) ??
    pick(data.checkout_url) ??
    pick(j.checkout_url)
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
  return {
    hasAuthorization: Boolean(auth),
    authLooksBearer: /^Bearer\s+/i.test(auth),
    authorizationLength: auth.length,
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

    let body: {
      amount: unknown;
      email: unknown;
      description?: unknown;
      redirect_url?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { amount, email } = body;
    const descriptionRaw = body.description;
    const redirectUrlRaw = body.redirect_url;

    if (!amount || !email) {
      return json({ error: "Missing required fields: amount, email." }, 400);
    }

    const amountNumber = Number(amount);
    if (isNaN(amountNumber) || amountNumber <= 0) {
      return json({ error: "amount must be a positive number." }, 400);
    }
    if (Math.trunc(amountNumber) < 100) {
      return json({ error: "Minimum purchase amount is ₦100" }, 400);
    }

    const requestedEmail = String(email).trim().toLowerCase();
    const sessionEmail = authedUser.email?.trim().toLowerCase() ?? "";
    if (!sessionEmail || requestedEmail !== sessionEmail) {
      return json({ error: "Email must match the signed-in account." }, 403);
    }

    const businessId: string =
      String((Deno.env.get("POCKETFI_BUSINESS_ID") ?? DEFAULT_BUSINESS_ID).trim()) || DEFAULT_BUSINESS_ID;
    const redirectUrl =
      (typeof redirectUrlRaw === "string" && redirectUrlRaw.trim())
        ? redirectUrlRaw.trim()
        : DEFAULT_REDIRECT_URL;
    const description =
      typeof descriptionRaw === "string" && descriptionRaw.trim()
        ? descriptionRaw.trim()
        : DEFAULT_DESCRIPTION;

    // Postman: only these fields — amount as string (e.g. "10").
    const payload = {
      amount: String(Math.trunc(amountNumber)),
      email: authedUser.email ?? String(email),
      business_id: businessId,
      redirect_url: redirectUrl,
      description,
    };

    console.log("[pocketfi-init] PocketFi payload (Postman shape) →", payload);

    const initUrlRaw = Deno.env.get("POCKETFI_INIT_URL");
    if (!initUrlRaw || !initUrlRaw.trim()) {
      return json({
        error: "POCKETFI_INIT_URL is required. Set the exact PocketFi v2 initialization URL in secrets.",
      }, 500);
    }
    // Use exactly what is stored in the secret (no suffixing/normalization).
    const initUrlOverride = initUrlRaw;
    const candidateEndpoints = [initUrlOverride];
    console.log("[pocketfi-init] Using strict POCKETFI_INIT_URL only:", initUrlOverride);

    const candidatePayloads = [payload];

    const baseHeaders = { "Content-Type": "application/json" };

    // PocketFi v1: raw secret in Authorization (no "Bearer" prefix).
    const authStrategies: { name: string; headers: Record<string, string> }[] = [{
      name: "Raw secret token (Authorization)",
      headers: { ...baseHeaders, Authorization: secretKey },
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
                "Set the exact POCKETFI_INIT_URL and verify POCKETFI_SECRET_KEY.",
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
            const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
            const looksHtml =
              contentType.includes("text/html") ||
              /^\s*<!doctype html/i.test(txt) ||
              /^\s*<html/i.test(txt);
            console.log(`[pocketfi-init] ${endpoint} [${name}] -> ${res.status}:`, txt.slice(0, 800));
            if (looksHtml) {
              console.log("Error: PocketFi returned HTML instead of API response. Check URL.");
            }

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
                  console.log("[pocketfi-init] ✓ payment link from non-JSON body via", name);
                  return json({
                    payment_link: fromRaw,
                    checkoutUrl: fromRaw,
                    checkout_url: fromRaw,
                  });
                }
                console.error("[pocketfi-init] OK but body not JSON and no URL found; sample:", txt.slice(0, 400));
                return json({
                  error:
                    "PocketFi returned a non-JSON success response without a recognizable payment_link URL. " +
                      "Confirm POCKETFI_INIT_URL matches the Postman collection.",
                }, 502);
              }
              lastNon404Error = txt.slice(0, 500);
              continue;
            }

            if (res.ok) {
              let paymentLink = extractPaymentLink(pocketFiJson);
              if (!paymentLink && txt) {
                paymentLink = extractCheckoutUrlFromRawBody(txt);
              }
              if (paymentLink) {
                console.log("[pocketfi-init] ✓ payment_link via", name);
                return json({
                  payment_link: paymentLink,
                  checkoutUrl: paymentLink,
                  checkout_url: paymentLink,
                });
              }
              console.error("[pocketfi-init] OK but no payment_link:", pocketFiJson);
              return json({
                error: "PocketFi did not return payment_link in the response.",
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
        attempted_url: initUrlOverride,
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
