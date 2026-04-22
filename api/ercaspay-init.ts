type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type InitiateBody = {
  amount?: number | string;
  email?: string;
  reference?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

function normalize(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

const SUPERADMIN_EMAILS = new Set([
  "growthprofesors@gmail.com",
  "godwindavid199501@gmail.com",
]);

function isSuperAdminEmail(email: string | null | undefined): boolean {
  return SUPERADMIN_EMAILS.has(normalize(email));
}

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function pickCheckoutUrl(payload: Record<string, unknown>): string {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const nested = (data.result ?? {}) as Record<string, unknown>;
  return String(
    data.checkout_url ??
      nested.checkoutUrl ??
      data.authorization_url ??
      data.payment_url ??
      nested.checkout_url ??
      nested.authorization_url ??
      payload.checkout_url ??
      payload.authorization_url ??
      "",
  ).trim();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = (req.body ?? {}) as InitiateBody;
  const amount = asPositiveInt(body.amount, 0);
  const email = String(body.email ?? "").trim();
  const reference = String(body.reference ?? "").trim();
  const callbackUrl = String(body.callbackUrl ?? "").trim();
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  if (!amount || !email || !reference || !callbackUrl) {
    res.status(400).json({
      error: "Missing required fields: amount, email, reference, callbackUrl.",
    });
    return;
  }

  if (isSuperAdminEmail(email)) {
    res.status(200).json({
      checkoutUrl: callbackUrl,
      checkout_url: callbackUrl,
      reference,
      simulated: true,
      bypass: true,
      message: "Admin bypass: ErcasPay checkout skipped.",
    });
    return;
  }

  const secretKey = (process.env.ERCASPAY_SECRET_KEY ?? "").trim();
  const publicKey = (process.env.NEXT_PUBLIC_ERCASPAY_PUBLIC_KEY ?? "").trim();
  if (!secretKey || !publicKey) {
    res.status(500).json({ error: "ErcasPay is not configured." });
    return;
  }

  const payload = {
    amount,
    currency: "NGN",
    payment_reference: reference,
    reference,
    callback_url: callbackUrl,
    redirect_url: callbackUrl,
    customer: { email },
    email,
    metadata,
  };

  let providerRes: Response;
  try {
    providerRes = await fetch("https://api.ercaspay.com/api/v1/payment/initiate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
        "x-public-key": publicKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    res.status(502).json({ error: "Network error reaching ErcasPay.", details: String(error) });
    return;
  }

  let providerJson: Record<string, unknown>;
  try {
    providerJson = (await providerRes.json()) as Record<string, unknown>;
  } catch {
    res.status(502).json({ error: `ErcasPay returned invalid JSON (HTTP ${providerRes.status}).` });
    return;
  }

  if (!providerRes.ok) {
    res.status(502).json({
      error: String(providerJson.message ?? providerJson.error ?? `ErcasPay HTTP ${providerRes.status}`),
      provider: providerJson,
    });
    return;
  }

  const checkoutUrl = pickCheckoutUrl(providerJson);
  if (!checkoutUrl) {
    res.status(502).json({
      error: "ErcasPay did not return a checkout_url.",
      provider: providerJson,
    });
    return;
  }

  res.status(200).json({
    checkoutUrl,
    checkout_url: checkoutUrl,
    reference: String(
      (providerJson.data as Record<string, unknown> | undefined)?.reference ?? reference,
    ),
    provider: "ercaspay",
  });
}
