import crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false,
  },
};

function getSupabaseServiceClient(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("Missing Supabase service env.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // 1. Read Raw Body
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

    // Parse JSON
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const businessId = payload.businessId;
    const transaction = payload.transaction;

    if (!transaction || !transaction.reference) {
      res.status(400).json({ error: "Missing transaction reference" });
      return;
    }

    const txRef = transaction.reference;
    const amount = Number(transaction.amount || 0);

    // 2. The Signature Header Bug
    // Checking all four potential header names
    const getHeader = (name: string) => {
      const val = req.headers[name] || req.headers[name.toLowerCase()];
      return Array.isArray(val) ? val[0] : val;
    };

    const signature = 
      getHeader("http_pocketfi_signature") ??
      getHeader("pocketfi-signature") ??
      getHeader("x-pocketfi-signature") ??
      getHeader("pocketfi_signature");

    if (!signature) {
      res.status(401).json({ error: "Missing PocketFi signature" });
      return;
    }

    // 3. The HMAC Hashing
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

    // Signature verified. Proceed with idempotency check
    const supabaseService = getSupabaseServiceClient();

    // 4. Duplicate Webhook Prevention (Idempotency)
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

    // If transaction doesn't exist, we could create it depending on business logic,
    // but typically a topup transaction is initialized beforehand.
    // Assuming transaction must exist from initialization:
    if (!existingTx) {
      // In some systems, we create it. But let's assume it was initialized.
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    if (existingTx.status === "completed" || existingTx.balance_credited === true) {
      console.log(`Transaction ${txRef} already completed. Ignoring duplicate webhook.`);
      res.status(200).json({ ok: true, message: "Transaction already processed (Idempotent)" });
      return;
    }

    // Update the transaction to completed
    const { error: updateError } = await supabaseService
      .from("transactions")
      .update({
        status: "completed",
        amount: amount > 0 ? amount : existingTx.amount, // Update amount if pocketfi returns it
      })
      .eq("reference", txRef)
      .in("status", ["pending", "initiated"]);

    if (updateError) {
      console.error("Failed to update transaction:", updateError);
      res.status(500).json({ error: "Failed to update transaction" });
      return;
    }

    res.status(200).json({ ok: true, message: "Transaction successfully credited" });
  } catch (err) {
    console.error("Unhandled webhook error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
