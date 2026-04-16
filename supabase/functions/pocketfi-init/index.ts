import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Paystack transaction initialize. Legacy function slug stays `pocketfi-init` for stable client URLs.
 *
 * Secret: PAYSTACK_SECRET_KEY (sk_test_… / sk_live_…) — value only, no "Bearer " prefix in the secret.
 *
 * Client sends amount in Naira; this function converts to Kobo (×100).
 * callback_url is always https://elonmarketplace.com.ng/dashboard/payments (not client-overridable).
 */

const CALLBACK_URL = "https://elonmarketplace.com.ng/dashboard/payments";
/** Exact Paystack endpoint — no trailing slash, no env override (avoids typos / Invalid key confusion). */
const PAYSTACK_INIT_URL = "https://api.paystack.co/transaction/initialize";

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
      console.error("[legacy-paystack-init] SUPABASE_URL or SUPABASE_ANON_KEY missing.");
      return json({ error: "Server configuration error." }, 500);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authErr } = await supabaseAuth.auth.getUser();
    if (authErr || !authData.user) {
      console.error("[legacy-paystack-init] auth.getUser failed:", authErr?.message);
      return json({ error: authErr?.message ?? "Invalid or expired session." }, 401);
    }
    const authedUser = authData.user;

    const rawKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (rawKey == null || rawKey.trim() === "") {
      console.error("[legacy-paystack-init] PAYSTACK_SECRET_KEY not set.");
      return json({ error: "Payment gateway not configured. Contact support." }, 500);
    }
    let paystackSecret = rawKey.trim();
    if (
      (paystackSecret.startsWith('"') && paystackSecret.endsWith('"')) ||
      (paystackSecret.startsWith("'") && paystackSecret.endsWith("'"))
    ) {
      paystackSecret = paystackSecret.slice(1, -1).trim();
    }
    if (!paystackSecret.startsWith("sk_")) {
      console.warn("[legacy-paystack-init] PAYSTACK_SECRET_KEY should start with sk_test_ or sk_live_.");
    }
    // Exactly one space after "Bearer"; no quotes in the header value.
    const authorizationHeader = "Bearer " + paystackSecret;

    let body: { amount: unknown; email: unknown; product_id?: unknown; quantity?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { amount, email, product_id: productIdRaw, quantity: quantityRaw } = body;
    if (!amount || !email) {
      return json({ error: "Missing required fields: amount, email." }, 400);
    }

    const amountNaira = Number(amount);
    if (isNaN(amountNaira) || amountNaira <= 0) {
      return json({ error: "amount must be a positive number (Naira)." }, 400);
    }
    if (Math.trunc(amountNaira) < 100) {
      return json({ error: "Minimum purchase amount is ₦100" }, 400);
    }

    const requestedEmail = String(email).trim().toLowerCase();
    const sessionEmail = authedUser.email?.trim().toLowerCase() ?? "";
    if (!sessionEmail || requestedEmail !== sessionEmail) {
      return json({ error: "Email must match the signed-in account." }, 403);
    }

    const amountKobo = Math.round(Number(amountNaira) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo < 10000) {
      return json({ error: "Invalid amount after conversion to Kobo." }, 400);
    }

    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let productId: string | undefined;
    if (productIdRaw != null && String(productIdRaw).trim() !== "") {
      const pid = String(productIdRaw).trim();
      if (!UUID_RE.test(pid)) {
        return json({ error: "Invalid product_id." }, 400);
      }
      productId = pid;
    }
    let purchaseQty = 1;
    if (quantityRaw != null && quantityRaw !== "") {
      const q = Math.trunc(Number(quantityRaw));
      if (!Number.isFinite(q) || q < 1 || q > 50) {
        return json({ error: "quantity must be between 1 and 50." }, 400);
      }
      purchaseQty = q;
    }

    const paystackBody: {
      email: string;
      amount: number;
      callback_url: string;
      metadata: Record<string, string>;
    } = {
      email: authedUser.email ?? String(email).trim(),
      amount: amountKobo,
      callback_url: CALLBACK_URL,
      metadata: {
        user_id: authedUser.id,
        flow: productId ? "purchase" : "deposit",
        ...(productId
          ? { product_id: productId, quantity: String(purchaseQty) }
          : {}),
      },
    };

    console.log("[legacy-paystack-init] Paystack initialize", {
      url: PAYSTACK_INIT_URL,
      amount_naira: Math.trunc(amountNaira),
      amount_kobo: paystackBody.amount,
      amount_type: typeof paystackBody.amount,
      auth_prefix: authorizationHeader.slice(0, 12) + "…",
      callback_url: CALLBACK_URL,
    });

    const paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paystackBody),
    });

    const txt = await paystackRes.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
    } catch {
      console.error("[legacy-paystack-init] Paystack non-JSON:", txt.slice(0, 500));
      return json(
        {
          error: "Paystack returned an invalid response.",
          upstream_status: paystackRes.status,
          upstream_raw: txt.slice(0, 2000),
        },
        502,
      );
    }

    const data = parsed.data as Record<string, unknown> | undefined;
    const authorizationUrl =
      data && typeof data.authorization_url === "string"
        ? data.authorization_url.trim()
        : undefined;
    const reference = data && typeof data.reference === "string" ? data.reference : undefined;

    if (!parsed.status || !authorizationUrl) {
      const msg =
        (typeof parsed.message === "string" && parsed.message) ||
        `Paystack error (HTTP ${paystackRes.status})`;
      console.error("[legacy-paystack-init] Paystack init failed:", msg, parsed);
      return json(
        {
          error: msg,
          upstream_status: paystackRes.status,
          upstream_raw: txt.slice(0, 2000),
        },
        502,
      );
    }

    // Pending purchase rows are inserted by the client (PurchaseModal) after init succeeds,
    // same pattern as wallet deposits — avoids duplicate rows and keeps RLS on the user session.

    return json({
      authorization_url: authorizationUrl,
      checkoutUrl: authorizationUrl,
      checkout_url: authorizationUrl,
      reference,
      data,
    });
  } catch (e) {
    console.error("[legacy-paystack-init] unhandled:", e);
    return json(
      { error: "payment-init crashed.", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
