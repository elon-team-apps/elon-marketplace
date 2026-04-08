import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Paystack transaction initialize. Function name stays `pocketfi-init` for stable client URLs.
 *
 * Secret: PAYSTACK_SECRET_KEY (sk_test_… / sk_live_…)
 * Optional: PAYSTACK_INITIALIZE_URL — default https://api.paystack.co/transaction/initialize
 *
 * Client sends amount in Naira; this function converts to Kobo (×100).
 * callback_url is always https://elonmarketplace.com.ng/dashboard/payments (not client-overridable).
 */

const CALLBACK_URL = "https://elonmarketplace.com.ng/dashboard/payments";
const PAYSTACK_DEFAULT_URL = "https://api.paystack.co/transaction/initialize";

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

    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
    if (!paystackSecret) {
      console.error("[pocketfi-init] PAYSTACK_SECRET_KEY not set.");
      return json({ error: "Payment gateway not configured. Contact support." }, 500);
    }

    let body: { amount: unknown; email: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { amount, email } = body;
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

    const amountKobo = Math.round(amountNaira * 100);

    const paystackBody = {
      email: authedUser.email ?? String(email),
      amount: amountKobo,
      callback_url: CALLBACK_URL,
    };

    const initUrl =
      (Deno.env.get("PAYSTACK_INITIALIZE_URL")?.trim() || PAYSTACK_DEFAULT_URL).replace(/\/+$/, "");

    console.log("[pocketfi-init] Paystack initialize", {
      url: initUrl,
      amount_naira: Math.trunc(amountNaira),
      amount_kobo: amountKobo,
      callback_url: CALLBACK_URL,
    });

    const paystackRes = await fetch(initUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paystackBody),
    });

    const txt = await paystackRes.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
    } catch {
      console.error("[pocketfi-init] Paystack non-JSON:", txt.slice(0, 500));
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
      console.error("[pocketfi-init] Paystack init failed:", msg, parsed);
      return json(
        {
          error: msg,
          upstream_status: paystackRes.status,
          upstream_raw: txt.slice(0, 2000),
        },
        502,
      );
    }

    return json({
      authorization_url: authorizationUrl,
      checkoutUrl: authorizationUrl,
      checkout_url: authorizationUrl,
      reference,
      data,
    });
  } catch (e) {
    console.error("[pocketfi-init] unhandled:", e);
    return json(
      { error: "payment-init crashed.", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
