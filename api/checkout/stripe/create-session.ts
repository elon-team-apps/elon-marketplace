type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type StripeCheckoutRequest = {
  productId?: string;
  quantity?: number;
  customerEmail?: string;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = (req.body ?? {}) as StripeCheckoutRequest;
  const productId = String(body.productId ?? "").trim();
  const quantity = Math.max(1, Math.trunc(Number(body.quantity ?? 1)));
  const customerEmail = String(body.customerEmail ?? "").trim();

  if (!productId || !customerEmail) {
    res.status(400).json({ error: "Missing required fields: productId, customerEmail." });
    return;
  }

  // Draft endpoint for future Stripe migration.
  // Keep this response contract stable so the frontend swap is low-risk later.
  res.status(501).json({
    ok: false,
    provider: "stripe",
    message: "Stripe checkout is scaffolded but not active yet.",
    draft: true,
    received: { productId, quantity, customerEmail },
  });
}
