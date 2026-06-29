import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | Record<string, unknown>;
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

  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || typeof authHeader !== "string") {
      res.status(401).json({ error: "Unauthorized: Missing Authorization header" });
      return;
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const supabase = getSupabaseServiceClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      res.status(401).json({ error: "Unauthorized: Invalid token" });
      return;
    }

    // Check if user already has a virtual account
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
      phone: "00000000000",
      businessId: businessId,
      bank: "wema" // Or safehaven, kuda, etc.
    };

    const fwRes = await fetch("https://api.pocketfi.ng/api/v1/bank-accounts/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await fwRes.json().catch(() => ({}));

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

    // Save to profiles
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
