/**
 * /api/pay  — Vercel Node.js Serverless Function
 *
 * Proxies PocketFi payment initialization server-to-server, bypassing
 * the browser CORS restriction on api.pocketfi.ng.
 *
 * Required Vercel Environment Variable (server-side only, no VITE_ prefix):
 *   POCKETFI_SECRET_KEY
 *
 * POST body (JSON):  { amount: number, email: string, reference: string, callbackUrl: string, metadata?: object }
 * Response (JSON):   { checkoutUrl: string } | { error: string }
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
  const isAdminBypass = normalizedEmail === "growthprofesors@gmail.com";

  if (!amount || !email || !reference || !callbackUrl) {
    res.status(400).json({
      error: "Missing required fields: amount, email, reference, callbackUrl.",
    });
    return;
  }

  // Admin testing path: allow checkout init without PocketFi secret.
  if (isAdminBypass) {
    res.status(200).json({
      checkoutUrl: String(callbackUrl),
      simulated: true,
      bypass: true,
      message: "Admin bypass: PocketFi checkout skipped.",
    });
    return;
  }

  // ── Secret key ──────────────────────────────────────────────────────────────
  const secretKey = process.env.POCKETFI_SECRET_KEY;
  if (!secretKey) {
    console.error("[/api/pay] POCKETFI_SECRET_KEY is not set.");
    res.status(500).json({ error: "Payment service is not configured." });
    return;
  }

  // amount must be a plain integer (Naira) — PocketFi rejects floats / strings
  const amountInt = Math.floor(Number(amount));
  if (!Number.isFinite(amountInt) || amountInt < 1) {
    res.status(400).json({ error: "amount must be a positive integer (Naira)." });
    return;
  }

  // ── Call PocketFi server-to-server ──────────────────────────────────────────
  const POCKETFI_URL = "https://api.pocketfi.ng/v1/transaction/initialize";

  let pocketRes: Response;
  try {
    pocketRes = await fetch(POCKETFI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        amount:       amountInt,
        email:        String(email),
        reference:    String(reference),
        callback_url: String(callbackUrl),
        metadata: typeof metadata === "object" && metadata ? metadata : undefined,
      }),
    });
  } catch (err) {
    console.error("[/api/pay] Network error reaching PocketFi:", err);
    res.status(502).json({ error: "Network error reaching PocketFi." });
    return;
  }

  // ── Parse PocketFi response ─────────────────────────────────────────────────
  let pocketJson: Record<string, unknown>;
  try {
    pocketJson = await pocketRes.json();
  } catch {
    console.error("[/api/pay] PocketFi returned non-JSON, status:", pocketRes.status);
    res.status(502).json({
      error: `PocketFi returned an unexpected response (HTTP ${pocketRes.status}).`,
    });
    return;
  }

  console.log("[/api/pay] PocketFi status:", pocketRes.status, "| body:", pocketJson);

  if (!pocketRes.ok) {
    const msg = String(
      pocketJson?.message ?? pocketJson?.error ?? `HTTP ${pocketRes.status}`
    );
    res.status(502).json({ error: `PocketFi error: ${msg}` });
    return;
  }

  // ── Extract checkout URL ────────────────────────────────────────────────────
  // PocketFi may nest it under .data or at the root — try all known field names
  const data = pocketJson?.data as Record<string, unknown> | undefined;
  const checkoutUrl = (
    data?.authorization_url ??
    data?.checkout_url ??
    data?.payment_url ??
    data?.url ??
    pocketJson?.authorization_url ??
    pocketJson?.checkout_url
  ) as string | undefined;

  if (!checkoutUrl) {
    console.error("[/api/pay] No checkout URL in PocketFi response:", pocketJson);
    res.status(502).json({
      error: "PocketFi did not return a checkout URL. Check Vercel function logs.",
    });
    return;
  }

  res.status(200).json({ checkoutUrl });
}
