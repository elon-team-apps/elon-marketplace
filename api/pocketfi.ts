import * as crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, callback: (chunk: any) => void) => void;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: any) => void; end: () => void };
};

function getSupabaseServiceClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Missing Supabase service env.");
  return createClient(url, key, { auth: { persistSession: false } });
}

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

  const getHeader = (name: string) => {
    const val = req.headers[name] || req.headers[name.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  const signature = 
    getHeader("http_pocketfi_signature") ??
    getHeader("pocketfi-signature") ??
    getHeader("x-pocketfi-signature") ??
    getHeader("pocketfi_signature");

  try {
    const rawBody = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        resolve(data);
      });
      req.on("error", (err) => {
        reject(err);
      });
    });

    if (!rawBody) {
      res.status(400).json({ error: "Empty body" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    // --- WEBHOOK LOGIC ---
    if (signature) {
      const businessId = payload.businessId;
      const transaction = payload.transaction;

      if (!transaction || !transaction.reference) {
        res.status(400).json({ error: "Missing transaction reference" });
        return;
      }

      const txRef = transaction.reference;
      const amount = Number(payload.order?.amount || payload.order?.settlement_amount || 0);

      const secretKey = process.env.POCKETFI_SECRET_KEY || "";
      if (!secretKey) {
        console.error("Missing POCKETFI_SECRET_KEY in environment variables.");
        res.status(500).json({ error: "Server misconfiguration" });
        return;
      }

      const expectedSignature = crypto
        .createHmac("sha512", secretKey)
        .update(rawBody)
        .digest("hex");

      if (signature !== expectedSignature) {
        console.error(`Invalid Signature. Expected: ${expectedSignature}, Received: ${signature}`);
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      const supabaseService = getSupabaseServiceClient();

      const { data: existingTx, error: txLookupError } = await supabaseService
        .from("transactions")
        .select("id, status, balance_credited, amount")
        .eq("reference", txRef)
        .maybeSingle();

      if (txLookupError) {
        console.error("Database lookup error:", txLookupError);
        res.status(500).json({ error: "Database error" });
        return;
      }

      if (!existingTx) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }

      if (existingTx.status === "completed" || existingTx.balance_credited === true) {
        res.status(200).json({ ok: true, message: "Transaction already processed (Idempotent)" });
        return;
      }

      const { error: updateError } = await supabaseService
        .from("transactions")
        .update({
          status: "completed",
          amount: amount > 0 ? amount : existingTx.amount,
        })
        .eq("reference", txRef)
        .in("status", ["pending", "initiated"]);

      if (updateError) {
        console.error("Failed to update transaction:", updateError);
        res.status(500).json({ error: "Failed to update transaction" });
        return;
      }

      res.status(200).json({ ok: true, message: "Transaction successfully credited" });
      return;
    }

    // --- INIT LOGIC ---
    const initAmount = asPositiveInt(payload.amount, 0);
    const email = String(payload.email ?? "").trim();
    const tx_ref = String(payload.tx_ref ?? "").trim();
    const callback_url = String(payload.callback_url ?? "").trim();
    
    if (!initAmount || !email || !tx_ref || !callback_url) {
      res.status(400).json({ error: "Missing amount, email, tx_ref or callback_url." });
      return;
    }

    const businessId = (process.env.NEXT_PUBLIC_POCKETFI_BUSINESS_ID ?? "").trim();
    const secretKey = (process.env.POCKETFI_SECRET_KEY ?? "").trim();

    if (!businessId) {
      res.status(500).json({ error: "Missing NEXT_PUBLIC_POCKETFI_BUSINESS_ID." });
      return;
    }

    const fwPayload = {
      first_name: "Customer",
      last_name: email.split("@")[0] || "User",
      phone: "00000000000",
      business_id: businessId,
      email: email,
      redirect_link: callback_url,
      amount: initAmount.toString(),
    };

    const fwRes = await fetch("https://api.pocketfi.ng/api/v1/checkout/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secretKey ? { Authorization: `Bearer ${secretKey}` } : {}),
      },
      body: JSON.stringify(fwPayload),
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
    const payment_id = String(data.payment_id ?? "").trim();
    
    if (!checkout_url || !payment_id) {
      res.status(502).json({ error: "PocketFi did not return payment_link or payment_id.", provider: data });
      return;
    }

    // PocketFi generates its own reference (payment_id). We must update our database transaction to use this new reference!
    const supabaseService = getSupabaseServiceClient();
    await supabaseService
      .from("transactions")
      .update({ reference: payment_id })
      .eq("reference", tx_ref);

    res.status(200).json({ checkout_url, checkoutUrl: checkout_url, tx_ref: payment_id });
  } catch (err) {
    console.error("Unhandled pocketfi error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
