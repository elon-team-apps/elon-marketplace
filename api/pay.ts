/**
 * /api/pay — Vercel Node.js Serverless Function
 *
 * Initializes Paystack checkout server-to-server.
 * POST body: { amount, email, reference, callbackUrl, metadata? }
 * Response:  { checkoutUrl, authorization_url, reference } | { error }
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // ── CORS headers — must be set before ANY early return ──────────────────────
  // The browser sends an OPTIONS preflight before the real POST.
  // If CORS headers aren't present on the preflight response, the POST is blocked.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Respond to preflight immediately — no body needed
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // ── Method guard (POST only) ─────────────────────────────────────────────────
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  const body = req.body ?? {};
  const { amount, email, reference, callbackUrl, metadata } = body;
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const isAdminBypass =
    normalizedEmail === "growthprofesors@gmail.com" ||
    normalizedEmail === "godwindavid199501@gmail.com";

  if (!amount || !email || !reference || !callbackUrl) {
    res.status(400).json({
      error: "Missing required fields: amount, email, reference, callbackUrl.",
    });
    return;
  }

  // Admin testing path: allow checkout init without Paystack secret.
  if (isAdminBypass) {
    res.status(200).json({
      checkoutUrl: String(callbackUrl),
      simulated: true,
      bypass: true,
      message: "Admin bypass: Paystack checkout skipped.",
    });
    return;
  }

  // ── Secret key ──────────────────────────────────────────────────────────────
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    console.error("[/api/pay] PAYSTACK_SECRET_KEY is not set.");
    res.status(500).json({ error: "Payment service is not configured." });
    return;
  }

  // Paystack expects Kobo.
  const amountKobo = Math.floor(Number(amount));
  if (!Number.isFinite(amountKobo) || amountKobo < 100) {
    res.status(400).json({ error: "amount must be a positive integer in Kobo." });
    return;
  }

  // ── Call Paystack server-to-server ──────────────────────────────────────────
  const PAYSTACK_URL = "https://api.paystack.co/transaction/initialize";

  let paystackRes: Response;
  try {
    paystackRes = await fetch(PAYSTACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey.trim()}`,
      },
      body: JSON.stringify({
        amount: amountKobo,
        email: String(email),
        reference: String(reference),
        callback_url: String(callbackUrl),
        metadata: typeof metadata === "object" && metadata ? metadata : undefined,
      }),
    });
  } catch (err) {
    console.error("[/api/pay] Network error reaching Paystack:", err);
    res.status(502).json({ error: "Network error reaching Paystack." });
    return;
  }

  // ── Parse Paystack response ─────────────────────────────────────────────────
  let paystackJson: Record<string, unknown>;
  try {
    paystackJson = await paystackRes.json();
  } catch {
    console.error("[/api/pay] Paystack returned non-JSON, status:", paystackRes.status);
    res.status(502).json({
      error: `Paystack returned an unexpected response (HTTP ${paystackRes.status}).`,
    });
    return;
  }

  console.log("[/api/pay] Paystack status:", paystackRes.status, "| body:", paystackJson);

  if (!paystackRes.ok) {
    const msg = String(
      paystackJson?.message ?? paystackJson?.error ?? `HTTP ${paystackRes.status}`
    );
    res.status(502).json({ error: `Paystack error: ${msg}` });
    return;
  }

  const data = paystackJson?.data as Record<string, unknown> | undefined;
  const checkoutUrl = (
    data?.authorization_url ??
    paystackJson?.authorization_url ??
    paystackJson?.checkout_url
  ) as string | undefined;
  const resolvedReference = (
    data?.reference ??
    paystackJson?.reference ??
    reference
  ) as string | undefined;

  if (!checkoutUrl) {
    console.error("[/api/pay] No checkout URL in Paystack response:", paystackJson);
    res.status(502).json({
      error: "Paystack did not return a checkout URL. Check server logs.",
    });
    return;
  }

  res.status(200).json({
    checkoutUrl,
    authorization_url: checkoutUrl,
    reference: String(resolvedReference ?? reference),
  });
}
