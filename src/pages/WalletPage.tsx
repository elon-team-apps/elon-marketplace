import { useEffect, useState } from "react";
import { Wallet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    const qAmount = searchParams.get("amount");
    if (qAmount && /^\d+$/.test(qAmount)) {
      setAmount(qAmount);
    }
  }, [searchParams]);

  // ── Start PocketFi checkout ────────────────────────────────────────────────
  const startPocketFiCheckout = async () => {
    const naira = parseInt(amount, 10);
    if (isNaN(naira) || naira < 100) {
      toast({ title: "Minimum funding amount is ₦100", variant: "destructive" });
      return;
    }
    if (!currentUser?.email) {
      toast({ title: "Email not ready. Please refresh and try again.", variant: "destructive" });
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !supabaseAnon) {
      toast({ title: "Payment config missing", description: "Supabase env values are missing.", variant: "destructive" });
      return;
    }

    setCheckoutLoading(true);
    try {
      const reference = `PM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callbackUrl = `${window.location.origin}/dashboard/wallet`;

      const res = await fetch(`${supabaseUrl}/functions/v1/pocketfi-init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnon,
          Authorization: `Bearer ${supabaseAnon}`,
        },
        body: JSON.stringify({
          amount: naira,
          email: currentUser.email,
          reference,
          callbackUrl,
        }),
      });

      const data = await res.json().catch(() => ({} as { error?: string; checkoutUrl?: string }));
      if (!res.ok || !data?.checkoutUrl) {
        throw new Error(data?.error || "Could not initialize PocketFi checkout.");
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start PocketFi checkout.";
      toast({ title: "Checkout failed", description: msg, variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fund your wallet securely with PocketFi.
        </p>
      </div>

      {/* Balance card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
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

      <div className="glass-card p-6 space-y-5">
        <h2 className="font-heading font-semibold text-lg">Fund Wallet with PocketFi</h2>
        <div>
          <Label className="mb-2 block">Amount</Label>
          <div className="flex flex-wrap gap-2 mb-3">
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
          <Input
            type="number"
            min={100}
            step={100}
            placeholder="Enter amount e.g. 7500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1.5">Minimum funding amount: ₦100</p>
        </div>
        <Button
          className="w-full gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={startPocketFiCheckout}
          disabled={checkoutLoading || !amount || parseInt(amount) < 100}
        >
          {checkoutLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Redirecting to PocketFi…
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4" />
              Continue to PocketFi
            </>
          )}
        </Button>
      </div>

      {/* How it works */}
      <div className="glass-card p-6">
        <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          How it works
        </h3>
        <ol className="space-y-3">
          {[
            "Enter your preferred amount.",
            "Click Continue to PocketFi to complete payment.",
            "After successful payment, your wallet updates automatically.",
            "Return to products and complete your purchase.",
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

      {/* Warning */}
      <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-5 py-4">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Manual receipt uploads are disabled. Use PocketFi for all wallet funding transactions.
        </p>
      </div>
    </div>
  );
}
