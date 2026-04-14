import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaystackWebhookEvent = {
  event?: string;
  data?: {
    reference?: string;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function verifySignature(rawBody: string, headerSignature: string, secret: string): boolean {
  const computed = createHmac("sha512", secret).update(rawBody).digest("hex");
  const provided = headerSignature.trim().toLowerCase();
  const expected = computed.trim().toLowerCase();

  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!paystackSecret) {
    console.error("[PaystackWebhook] Missing PAYSTACK_SECRET_KEY");
    return NextResponse.json({ error: "Server misconfigured: missing Paystack secret." }, { status: 500 });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("[PaystackWebhook] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ error: "Server misconfigured: missing Supabase server credentials." }, { status: 500 });
  }

  if (!verifySignature(rawBody, signature, paystackSecret)) {
    console.error("[PaystackWebhook] Invalid signature", {
      signature_present: Boolean(signature),
      body_preview: rawBody.slice(0, 300),
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: PaystackWebhookEvent;
  try {
    payload = JSON.parse(rawBody) as PaystackWebhookEvent;
  } catch (error) {
    console.error("[PaystackWebhook] Invalid JSON payload", { error, rawBody });
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  console.log("[PaystackWebhook] Event received", {
    event: payload.event,
    reference: payload.data?.reference ?? null,
    status: payload.data?.status ?? null,
    payload,
  });

  if (payload.event !== "charge.success") {
    return NextResponse.json({ ok: true, message: `Ignored event ${payload.event ?? "unknown"}.` }, { status: 200 });
  }

  const reference = String(payload.data?.reference ?? "").trim();
  if (!reference) {
    console.error("[PaystackWebhook] charge.success missing reference", { payload });
    return NextResponse.json({ error: "Missing transaction reference." }, { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("transactions")
    .update({ status: "success" })
    .eq("reference", reference)
    .select("id, reference, status");

  if (updateError) {
    console.error("[PaystackWebhook] Failed to update transaction", {
      reference,
      error: {
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      },
      payload,
    });
    return NextResponse.json(
      { error: "Failed to update transaction status.", details: safeStringify(updateError) },
      { status: 500 },
    );
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.warn("[PaystackWebhook] No matching transaction for reference", { reference, payload });
    return NextResponse.json({ ok: true, message: "No transaction matched this reference." }, { status: 200 });
  }

  console.log("[PaystackWebhook] Transaction marked success", {
    reference,
    updated_count: updatedRows.length,
    updated_rows: updatedRows,
  });

  return NextResponse.json({ ok: true, updated: updatedRows.length }, { status: 200 });
}
