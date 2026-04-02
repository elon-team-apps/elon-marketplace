import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";

// ─── PocketFi direct initialization ──────────────────────────────────────────
// Uses VITE_POCKETFI_PUBLIC_KEY (safe to ship in the browser bundle).
// The secret key is only used server-side in the pocketfi-webhook Edge Function
// for HMAC signature verification of incoming webhook payloads.

const POCKETFI_INIT_URL = "https://api.pocketfi.ng/v1/transaction/initialize";

async function initializePocketFiPayment(params: {
  amount: number;
  email: string;
  reference: string;
  callbackUrl: string;
}): Promise<{ checkoutUrl: string } | { error: string }> {
  const publicKey = import.meta.env.VITE_POCKETFI_PUBLIC_KEY as string | undefined;

  if (!publicKey) {
    return { error: "VITE_POCKETFI_PUBLIC_KEY is not set. Add it to your .env file and hosting environment variables." };
  }

  const payload = {
    amount:       params.amount,        // Naira — PocketFi does not use kobo for init
    email:        params.email,
    reference:    params.reference,
    callback_url: params.callbackUrl,
  };

  let res: Response;
  try {
    res = await fetch(POCKETFI_INIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${publicKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.error("[PocketFi] Network error:", networkErr);
    return { error: "Connection to PocketFi failed. Please check your internet or try again." };
  }

  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch {
    return { error: `Connection to PocketFi failed. Please check your internet or try again.` };
  }


  if (!res.ok) {
    const msg = (json?.message ?? json?.error ?? `HTTP ${res.status}`) as string;
    return { error: `PocketFi error: ${msg}` };
  }

  // Try every known field name PocketFi might use for the checkout URL.
  const data = json?.data as Record<string, unknown> | undefined;
  const checkoutUrl =
    (data?.authorization_url ?? data?.checkout_url ?? data?.payment_url ?? data?.url ??
     json?.authorization_url ?? json?.checkout_url) as string | undefined;

  if (!checkoutUrl) {
    console.error("[PocketFi] No checkout URL in response:", json);
    return { error: "PocketFi did not return a payment URL. Check the browser console for the raw response." };
  }

  return { checkoutUrl };
}

// ─── Quick-select deposit amounts ─────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const { currentUser, topUpWallet } = useApp();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [returnStatus, setReturnStatus] = useState<
    "idle" | "verifying" | "success" | "failed"
  >("idle");
  const [returnRef, setReturnRef] = useState<string | null>(null);

  // ── Handle return from PocketFi checkout ──────────────────────────────────
  // PocketFi redirects back to: /dashboard/wallet?ref=elon_xxx_yyy
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;

    setSearchParams({}, { replace: true });
    setReturnRef(ref);
    setReturnStatus("verifying");

    let attempts = 0;
    const maxAttempts = 10; // 10 × 1.5 s = 15 s max wait

    const poll = async () => {
      attempts++;
      if (!supabase) { setReturnStatus("failed"); return; }

      const { data, error } = await supabase
        .from("transactions")
        .select("status, amount")
        .eq("reference", ref)
        .single();

      if (!error && data?.status === "completed") {
        topUpWallet(data.amount);
        setReturnStatus("success");
        toast({
          title: "Wallet funded!",
          description: `₦${data.amount.toLocaleString()} has been added to your balance.`,
        });
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(poll, 1500);
      } else {
        setReturnStatus("failed");
      }
    };

    setTimeout(poll, 1500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initiate a new deposit ─────────────────────────────────────────────────
  const handleDeposit = async () => {
    const naira = parseInt(amount, 10);
    if (isNaN(naira) || naira < 100) {
      toast({ title: "Minimum deposit is ₦100", variant: "destructive" });
      return;
    }

    if (!currentUser?.id || currentUser.id === "") {
      toast({
        title: "Profile not ready",
        description: "Your account is still loading. Please wait a moment and try again.",
        variant: "destructive",
      });
      return;
    }

    if (!supabase) {
      toast({
        title: "Payment unavailable",
        description: "Supabase is not configured.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    // 1. Unique reference — encodes user ID for easy webhook lookup
    const reference = `elon_${currentUser.id}_${Date.now()}`;

    // 2. Insert a pending transaction row BEFORE leaving the page so the
    //    webhook handler finds the row when PocketFi fires the callback.
    const { error: insertError } = await supabase.from("transactions").insert({
      user_id:   currentUser.id,
      amount:    naira,
      type:      "deposit",
      status:    "pending",
      reference,
    });

    if (insertError) {
      console.error("[WalletPage] Failed to create pending transaction:", insertError.message);
      toast({
        title: "Could not start payment",
        description: insertError.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // 3. Call the Edge Function to get the PocketFi checkout URL
    const callbackUrl = `${window.location.origin}/dashboard/wallet?ref=${reference}`;
    // window.location.origin resolves dynamically (e.g. https://elonmarketplace.com.ng)
    // so this works on any domain without hardcoding.
    const result = await initializePocketFiPayment({
      amount:      naira,
      email:       currentUser.email ?? "",
      reference,
      callbackUrl,
    });

    if ("error" in result) {
      console.error("[WalletPage] Payment init failed:", result.error);
      toast({
        title: "Payment initialization failed",
        description: result.error,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // 4. Redirect — browser leaves the app here.
    //    setLoading(false) intentionally omitted: keep spinner up during redirect
    //    to prevent double-clicks while the browser navigates.
    window.location.href = result.checkoutUrl;
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  const naira = parseInt(amount || "0", 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-heading text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fund your wallet to purchase logs instantly
        </p>
      </div>

      {/* Return status banners */}
      {returnStatus === "verifying" && (
        <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-5 py-4">
          <Loader2 className="h-5 w-5 text-blue-400 animate-spin shrink-0" />
          <div>
            <p className="text-sm font-semibold">Verifying your payment…</p>
            <p className="text-xs text-muted-foreground">
              Waiting for PocketFi confirmation. This takes up to 15 seconds.
            </p>
          </div>
        </div>
      )}

      {returnStatus === "success" && (
        <div className="flex items-center gap-3 bg-accent/10 border border-accent/20 rounded-xl px-5 py-4">
          <CheckCircle className="h-5 w-5 text-accent shrink-0" />
          <div>
            <p className="text-sm font-semibold text-accent">Payment confirmed!</p>
            <p className="text-xs text-muted-foreground">
              Your wallet balance has been updated. You can now purchase products.
            </p>
          </div>
        </div>
      )}

      {returnStatus === "failed" && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-4">
          <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Payment received — still processing</p>
            <p className="text-xs text-muted-foreground">
              Your payment was received but the confirmation is still being processed.
              Refresh this page in 30 seconds to see your updated balance.
              {returnRef && (
                <span className="block mt-1 font-mono">Ref: {returnRef}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Balance card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Available Balance</p>
            <p className="font-heading text-3xl font-bold">
              ₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Deposit form */}
      <div className="glass-card p-6 space-y-5">
        <h2 className="font-heading font-semibold text-lg flex items-center gap-2">
          <ArrowDownLeft className="h-5 w-5 text-accent" />
          Fund Wallet
        </h2>

        {/* Quick-select amounts */}
        <div>
          <Label className="mb-2 block">Quick Select</Label>
          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((preset) => (
              <button
                key={preset}
                onClick={() => setAmount(preset.toString())}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150 ${
                  amount === preset.toString()
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-accent/50 hover:text-foreground"
                }`}
              >
                ₦{preset.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* Custom amount */}
        <div>
          <Label htmlFor="amount">Custom Amount (₦)</Label>
          <Input
            id="amount"
            type="number"
            min={100}
            step={100}
            className="mt-1.5"
            placeholder="Enter amount e.g. 5000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1.5">Minimum deposit: ₦100</p>
        </div>

        <Button
          className="w-full gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={handleDeposit}
          disabled={loading || !amount || naira < 100}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting to PocketFi…
            </>
          ) : (
            <>
              <ExternalLink className="h-4 w-4" />
              Pay ₦{naira > 0 ? naira.toLocaleString() : "—"} via PocketFi
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          You will be redirected to PocketFi's secure checkout.
          Your wallet is updated automatically once payment is confirmed.
        </p>
      </div>

      {/* How it works */}
      <div className="glass-card p-6">
        <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          How it works
        </h3>
        <ol className="space-y-3">
          {[
            "Enter the amount you want to add to your wallet.",
            "You are redirected to PocketFi's secure payment page.",
            "Complete the payment using your card or bank transfer.",
            "Your wallet balance is updated instantly and you are returned here.",
            "Use your balance to purchase any product instantly — no waiting.",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
