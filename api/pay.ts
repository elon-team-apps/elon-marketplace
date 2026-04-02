/**
 * /api/pay  — Vercel Serverless Function (Node.js runtime)
 *
 * Proxies PocketFi payment initialization server-to-server so the browser
 * never hits api.pocketfi.ng directly (which blocks cross-origin requests).
 *
 * Required Vercel Environment Variable (NOT prefixed with VITE_):
 *   POCKETFI_SECRET_KEY   — your PocketFi secret key
 *
 * Request  (POST, JSON):  { amount, email, reference, callbackUrl }
 * Response (JSON):        { checkoutUrl } | { error }
 */

const POCKETFI_INIT_URL = "https://api.pocketfi.ng/v1/transaction/initialize";

export default async function handler(
  req: { method: string; body: Record<string, unknown> },
  res: {
    status: (code: number) => {
      json: (body: Record<string, unknown>) => void;
    };
  }
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.POCKETFI_SECRET_KEY;
  if (!secretKey) {
    console.error("[/api/pay] POCKETFI_SECRET_KEY is not set in environment variables.");
    return res.status(500).json({
      error: "Payment service is not configured. Contact the site owner.",
    });
  }

  const { amount, email, reference, callbackUrl } = req.body ?? {};

  if (!amount || !email || !reference || !callbackUrl) {
    return res.status(400).json({
      error: "Missing required fields: amount, email, reference, callbackUrl.",
    });
  }

  // ── Call PocketFi server-to-server (no CORS restriction here) ──────────────
  let pocketRes: Response;
  try {
    pocketRes = await fetch(POCKETFI_INIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        amount:       Number(amount),
        email:        String(email),
        reference:    String(reference),
        callback_url: String(callbackUrl),
      }),
    });
  } catch (err) {
    console.error("[/api/pay] Network error reaching PocketFi:", err);
    return res.status(502).json({ error: "Network error reaching PocketFi." });
  }

  let json: Record<string, unknown>;
  try {
    json = await pocketRes.json();
  } catch {
    return res.status(502).json({
      error: `PocketFi returned a non-JSON response (HTTP ${pocketRes.status}).`,
    });
  }

  console.log(`[/api/pay] PocketFi responded — status ${pocketRes.status}:`, json);

  if (!pocketRes.ok) {
    const msg = String(json?.message ?? json?.error ?? `HTTP ${pocketRes.status}`);
    return res.status(502).json({ error: `PocketFi error: ${msg}` });
  }

  // Try every known field name PocketFi might use for the checkout URL
  const data = json?.data as Record<string, unknown> | undefined;
  const checkoutUrl = (
    data?.authorization_url ??
    data?.checkout_url ??
    data?.payment_url ??
    data?.url ??
    json?.authorization_url ??
    json?.checkout_url
  ) as string | undefined;

  if (!checkoutUrl) {
    console.error("[/api/pay] No checkout URL in PocketFi response:", json);
    return res.status(502).json({
      error: "PocketFi did not return a checkout URL. Check Vercel function logs.",
    });
  }

  return res.status(200).json({ checkoutUrl });
}
