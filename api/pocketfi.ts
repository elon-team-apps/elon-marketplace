import * as crypto from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?: (event: string, callback: (chunk: any) => void) => void;
  body?: string | Record<string, unknown>;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, pocketfi-signature, x-pocketfi-signature, http_pocketfi_signature");

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

  const authHeader = getHeader("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return handleVirtualAccountRequest(req, res, authHeader.replace("Bearer ", "").trim());
  }

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
        // Handle potential Virtual Account transfer (no pre-existing transaction)
        let matchedUser = null;
        const depositAmount = amount;

        // Try to match by virtual account number if present in payload
        const possibleAccountNum = payload.accountNumber || payload.account_number || payload.virtualAccount?.accountNumber || payload.sourceInformation?.accountNumber;
        if (possibleAccountNum) {
           const { data: profile } = await supabaseService.from("profiles").select("id").eq("virtual_account_number", possibleAccountNum).maybeSingle();
           if (profile) matchedUser = profile.id;
        }

        // Try to match by email if account number didn't match and email is present
        if (!matchedUser && payload.customer?.email) {
           const { data: profile } = await supabaseService.from("profiles").select("id").eq("email", payload.customer.email).maybeSingle();
           if (profile) matchedUser = profile.id;
        }
        
        if (matchedUser) {
           // We found the user for this spontaneous virtual account deposit!
           // Create a new transaction row to mark it as completed and trigger the DB trigger/credit logic
           const { error: insertError } = await supabaseService.from("transactions").insert({
               reference: txRef,
               user_id: matchedUser,
               amount: depositAmount > 0 ? depositAmount : 0,
               type: "deposit",
               status: "completed"
           });
           
           if (insertError) {
               // If there's a unique constraint violation on reference, it means it was already inserted
               // by a concurrent webhook call, which is fine (idempotent).
               if (insertError.code === '23505') {
                 res.status(200).json({ ok: true, message: "Virtual account deposit already processed (Idempotent)" });
                 return;
               }
               console.error("Failed to insert virtual account transaction:", insertError);
               res.status(500).json({ error: "Failed to insert transaction" });
               return;
           }
           
           res.status(200).json({ ok: true, message: "Virtual account deposit successfully credited" });
           return;
        }

        console.error("Webhook payload could not be matched to an existing transaction or virtual account user.", payload);
        res.status(404).json({ error: "Transaction not found and could not map to virtual account" });
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
    const publicKey = (process.env.NEXT_PUBLIC_POCKETFI_PUBLIC_KEY ?? process.env.POCKETFI_PUBLIC_KEY ?? "").trim();

    if (!businessId) {
      res.status(500).json({ error: "Missing NEXT_PUBLIC_POCKETFI_BUSINESS_ID." });
      return;
    }

    if (!publicKey) {
      res.status(500).json({ error: "Missing POCKETFI_PUBLIC_KEY." });
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
        Authorization: `Bearer ${publicKey}`,
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

async function handleVirtualAccountRequest(req: ApiRequest, res: ApiResponse, token: string) {
  try {
    const supabase = getSupabaseServiceClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("virtual_account_number, name, email")
      .eq("id", user.id)
      .single();

    if (profile?.virtual_account_number) {
      res.status(400).json({ error: "User already has a virtual account" });
      return;
    }

    const email = profile?.email || user.email || "";
    const nameParts = (profile?.name || email.split("@")[0] || "Customer").split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "User";

    const businessId = (process.env.NEXT_PUBLIC_POCKETFI_BUSINESS_ID ?? "").trim();
    const secretKey = (process.env.POCKETFI_SECRET_KEY ?? "").trim();

    if (!businessId) {
      res.status(500).json({ error: "Missing NEXT_PUBLIC_POCKETFI_BUSINESS_ID." });
      return;
    }
    if (!secretKey) {
      res.status(500).json({ error: "Missing POCKETFI_SECRET_KEY." });
      return;
    }

    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: "08000000000",
      businessId: businessId,
      bank: "safehaven"
    };

    const fwRes = await fetch("https://api.pocketfi.ng/api/v1/bank-accounts/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify(payload),
    });

    const fwResText = await fwRes.text();
    console.log("PocketFi Raw Response:", fwResText);
    
    let data: any = {};
    try {
      data = JSON.parse(fwResText);
    } catch (e) {
      console.error("Failed to parse PocketFi JSON:", e);
    }

    if (!fwRes.ok || data.status !== true) {
      console.error("PocketFi Virtual Account Error:", data);
      res.status(502).json({ error: data.message || data.error || "Failed to create virtual account." });
      return;
    }

    const banks = data.banks || [];
    if (banks.length === 0) {
      res.status(502).json({ error: "No bank details returned from PocketFi." });
      return;
    }

    const bankDetails = banks[0];
    const accountNumber = bankDetails.accountNumber;
    const bankName = bankDetails.bankName;
    const accountName = bankDetails.accountName;

    if (!accountNumber) {
      res.status(502).json({ error: "Missing account number in PocketFi response." });
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        virtual_account_number: accountNumber,
        virtual_account_bank: bankName,
        virtual_account_name: accountName
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Failed to update profile:", updateError);
      res.status(500).json({ error: "Failed to save virtual account details." });
      return;
    }

    res.status(200).json({ 
      success: true, 
      virtual_account_number: accountNumber,
      virtual_account_bank: bankName,
      virtual_account_name: accountName
    });

  } catch (err) {
    console.error("Virtual Account Generation Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
