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
  meta?: Record<string, unknown>;
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

  const secret = (process.env.FLUTTERWAVE_SECRET_KEY ?? "").trim();
  if (!secret) {
    res.status(500).json({ error: "Missing FLUTTERWAVE_SECRET_KEY." });
    return;
  }

  const payload = {
    tx_ref,
    amount,
    currency: "NGN",
    redirect_url: callback_url,
    customer: { email },
    meta: body.meta ?? {},
    customizations: {
      title: "Elon Marketplace",
      description: "Secure payment checkout",
    },
  };

  const fwRes = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error("[FlutterwaveInit] network error", error);
    return null;
  });

  if (!fwRes) {
    res.status(502).json({ error: "Network error reaching Flutterwave." });
    return;
  }

  const data = (await fwRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!fwRes.ok) {
    res.status(502).json({
      error: String(data.message ?? data.error ?? "Flutterwave init failed."),
      provider: data,
    });
    return;
  }

  const checkout_url = String(
    ((data.data as Record<string, unknown> | undefined)?.link ??
      (data.data as Record<string, unknown> | undefined)?.checkout_url ??
      data.checkout_url ??
      "") as string,
  ).trim();
  if (!checkout_url) {
    res.status(502).json({ error: "Flutterwave did not return checkout_url.", provider: data });
    return;
  }

  res.status(200).json({ checkout_url, checkoutUrl: checkout_url, tx_ref });
}
