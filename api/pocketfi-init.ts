type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type InitBody = {
  amount?: number | string;
  email?: string;
  tx_ref?: string;
  callback_url?: string;
};

function asPositiveInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = (req.body ?? {}) as InitBody;
  const amount = asPositiveInt(body.amount, 0);
  const email = String(body.email ?? "").trim();
  const tx_ref = String(body.tx_ref ?? "").trim();
  const callback_url = String(body.callback_url ?? "").trim();
  if (!amount || !email || !tx_ref || !callback_url) {
    res.status(400).json({ error: "Missing amount, email, tx_ref or callback_url." });
    return;
  }

  const businessId = (process.env.NEXT_PUBLIC_POCKETFI_BUSINESS_ID ?? "").trim();
  const secretKey = (process.env.POCKETFI_SECRET_KEY ?? "").trim();

  if (!businessId) {
    res.status(500).json({ error: "Missing NEXT_PUBLIC_POCKETFI_BUSINESS_ID." });
    return;
  }

  const payload = {
    first_name: "Customer",
    last_name: email.split("@")[0] || "User",
    phone: "00000000000",
    business_id: businessId,
    email: email,
    redirect_link: callback_url,
    amount: amount.toString(),
  };

  const fwRes = await fetch("https://api.pocketfi.ng/v1/checkout/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {}),
    },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error("[PocketFiInit] network error", error);
    return null;
  });

  if (!fwRes) {
    res.status(502).json({ error: "Network error reaching PocketFi." });
    return;
  }

  const data = (await fwRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!fwRes.ok || data.status !== "success") {
    res.status(502).json({
      error: String(data.message ?? data.error ?? "PocketFi init failed."),
      provider: data,
    });
    return;
  }

  const checkout_url = String(data.payment_link ?? "").trim();
  if (!checkout_url) {
    res.status(502).json({ error: "PocketFi did not return payment_link.", provider: data });
    return;
  }

  res.status(200).json({ checkout_url, checkoutUrl: checkout_url, tx_ref });
}
