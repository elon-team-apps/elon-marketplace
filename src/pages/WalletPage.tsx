import { useEffect, useState } from "react";
import { Wallet, Loader2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import {
  supabase,
} from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";
import { extractPaystackRedirectUrl } from "@/lib/paystackRedirect";

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const PENDING_REF_KEY = "paystack_pending_reference";
const LEGACY_PENDING_REF_KEY = "pocketfi_pending_reference";
/** Client-approved primary actions (Purchase / Continue) */
const BTN_NAVY = "#0f172a";

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const [searchParams] = useSearchParams();
  const { currentUser, refreshProfile } = useApp();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"pending" | "completed" | "failed" | null>(null);
  const [methods, setMethods] = useState({ pocketfi_enabled: true, manual_enabled: false });

  useEffect(() => {
    const qAmount = searchParams.get("amount");
    if (qAmount && /^\d+$/.test(qAmount)) {
      setAmount(qAmount);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("payment_method_settings")
      .select("pocketfi_enabled, manual_enabled")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMethods(data);
      });
  }, []);

  useEffect(() => {
    const fromUrl =
      searchParams.get("reference") ||
      searchParams.get("trxref") ||
      searchParams.get("tx_ref");
    const stored =
      localStorage.getItem(PENDING_REF_KEY) ?? localStorage.getItem(LEGACY_PENDING_REF_KEY);
    const ref = fromUrl || stored;
    if (ref) {
      setPendingRef(ref);
      localStorage.setItem(PENDING_REF_KEY, ref);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!pendingRef || !currentUser?.id || !supabase) return;

    let timer: number | undefined;
    const checkStatus = async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("status")
        .eq("reference", pendingRef)
        .eq("user_id", currentUser.id)
        .eq("type", "deposit")
        .maybeSingle();

      if (error || !data) return;

      const status = data.status as "pending" | "completed" | "failed";
      setPendingStatus(status);

      if (status === "completed") {
        void refreshProfile();
        toast({ title: "Wallet funded", description: "Payment verified and balance updated." });
        localStorage.removeItem(PENDING_REF_KEY);
        setPendingRef(null);
        return;
      }

      if (status === "failed") {
        toast({ title: "Payment failed", description: "Transaction verification failed.", variant: "destructive" });
        localStorage.removeItem(PENDING_REF_KEY);
        setPendingRef(null);
        return;
      }

      timer = window.setTimeout(checkStatus, 8000);
    };

    checkStatus();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [pendingRef, currentUser?.id, toast, refreshProfile]);

  // ── Start Paystack checkout (Edge Function slug kept: pocketfi-init) ───────
  const startPaystackCheckout = async () => {
    if (checkoutLoading) return;
    const numeric = Number(amount);
    const naira = Math.trunc(numeric);
    if (isNaN(naira) || naira < 100) {
      toast({ title: "Minimum funding amount is ₦100", variant: "destructive" });
      return;
    }
    if (!currentUser?.email) {
      toast({ title: "Email not ready. Please refresh and try again.", variant: "destructive" });
      return;
    }
    if (!currentUser?.id || !supabase) {
      toast({ title: "Session not ready. Please refresh and try again.", variant: "destructive" });
      return;
    }

    setCheckoutLoading(true);
    try {
      const { data: activeUserData } = await supabase.auth.getUser();
      if (!activeUserData.user) {
        throw new Error("No active login session. Please sign in again and retry.");
      }
      if (activeUserData.user.id !== currentUser.id) {
        throw new Error("Session mismatch. Refresh the page, then try again.");
      }

      const invokePromise = supabase.functions.invoke("pocketfi-init", {
        body: {
          amount: naira,
          email: currentUser.email,
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Paystack init request timeout")), 20_000);
      });
      const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as Awaited<typeof invokePromise>;

      if (error) {
        let statusCode: number | undefined;
        let bodyText = "";
        const ctx = (error as { context?: unknown }).context;
        if (ctx instanceof Response) {
          statusCode = ctx.status;
          try {
            bodyText = await ctx.text();
          } catch {
            bodyText = "";
          }
        }

        const details = `${error.message} ${statusCode ?? ""} ${bodyText}`;
        if (statusCode === 404 || statusCode === 504 || /404|504|not found|timeout|timed out/i.test(details)) {
          throw new Error("Payment Gateway is temporarily unavailable. Please try again shortly or contact support.");
        }
        throw new Error(error.message || "Unable to initialize Paystack checkout.");
      }

      const payload = (data ?? {}) as Record<string, unknown>;
      const checkoutUrl = extractPaystackRedirectUrl(payload);
      const paystackRef =
        typeof payload.reference === "string" && payload.reference.trim()
          ? payload.reference.trim()
          : null;
      if (!checkoutUrl) {
        const bodyErr =
          (typeof payload.error === "string" && payload.error) ||
          (typeof payload.message === "string" && payload.message) ||
          "Payment Gateway is temporarily unavailable. Please try again shortly or contact support.";
        if (/404|504|not found|timeout|timed out/i.test(bodyErr)) {
          throw new Error("Payment Gateway is temporarily unavailable. Please try again shortly or contact support.");
        }
        throw new Error(bodyErr);
      }

      if (!paystackRef) {
        throw new Error("Paystack did not return a transaction reference. Try again or contact support.");
      }

      // Persist pending deposit before redirect (reference must match Paystack for verification).
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: currentUser.id,
        amount: naira,
        type: "deposit",
        status: "pending",
        reference: paystackRef,
      });

      if (txError) {
        throw new Error(`Could not create pending transaction: ${txError.message}`);
      }
      localStorage.setItem(PENDING_REF_KEY, paystackRef);

      // Immediate handover: only `replace` so Back from Paystack skips the wallet step.
      const handoverUrl = checkoutUrl.trim();
      window.location.replace(handoverUrl);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start Paystack checkout.";
      const friendly = /aborted|timeout|load failed|failed to fetch|networkerror/i.test(msg)
        ? "Paystack is taking too long to respond. Please try again. If this keeps happening, verify `PAYSTACK_SECRET_KEY` in Supabase Edge Function secrets."
        : msg;
      toast({ title: "Checkout failed", description: friendly, variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-black dark:text-white">Wallet</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Fund your wallet securely with Paystack.
        </p>
      </div>

      {/* Balance card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-medium text-black dark:text-white">Available Balance</p>
            <p className="font-heading text-3xl font-bold text-black dark:text-white">
              ₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {pendingRef && pendingStatus !== "completed" && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 dark:border-amber-500/35">
          Payment pending verification... we are waiting for Paystack webhook confirmation.
        </div>
      )}

      <div className="glass-card p-6 space-y-5">
        <h2 className="font-heading font-semibold text-lg text-black dark:text-white">
          Fund Wallet with Paystack
        </h2>
        <div>
          <Label className="mb-2 block font-medium text-black dark:text-white">Amount</Label>
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK_AMOUNTS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset.toString())}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150 ${
                  amount === preset.toString()
                    ? "border-transparent text-white"
                    : "bg-transparent text-black dark:text-white border-slate-300 dark:border-white/60 hover:border-[#0f172a]/60 dark:hover:border-white"
                }`}
                style={amount === preset.toString() ? { background: BTN_NAVY } : undefined}
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
            className="border-slate-300 text-black placeholder:text-slate-500 dark:border-white/50 dark:bg-slate-950/80 dark:text-white dark:placeholder:text-slate-300"
          />
          <p className="text-xs mt-1.5 text-black dark:text-white">
            Minimum funding amount: ₦100
          </p>
        </div>
        {methods.pocketfi_enabled ? (
          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium h-10 px-4 py-2 text-white [&_svg]:text-white transition-opacity hover:opacity-95 disabled:pointer-events-none disabled:opacity-50 border-0"
            style={{ background: BTN_NAVY }}
            onClick={startPaystackCheckout}
            disabled={checkoutLoading || !amount || parseInt(amount) < 100}
          >
            {checkoutLoading ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" />
                <span className="text-white">Processing...</span>
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4 shrink-0 text-white" />
                <span className="text-white">Continue to Paystack</span>
              </>
            )}
          </button>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 dark:border-amber-500/35">
            Paystack checkout is currently disabled by admin.
          </div>
        )}

        {!methods.manual_enabled && (
          <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-black dark:border-white/40 dark:bg-slate-800/80 dark:text-white">
            Manual transfer is currently disabled by admin.
          </div>
        )}
        {methods.manual_enabled && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100 dark:border-emerald-500/35">
            Manual transfer is enabled. Contact support for manual funding instructions.
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="glass-card p-6">
        <h3 className="font-heading font-semibold mb-4 flex items-center gap-2 text-black dark:text-white">
          <Wallet className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          How it works
        </h3>
        <ol className="space-y-3">
          {[
            "Enter your preferred amount.",
            "Click Continue to Paystack to complete payment.",
            "After successful payment, your wallet updates automatically.",
            "Return to products and complete your purchase.",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
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
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Manual receipt uploads are disabled. Use Paystack for all wallet funding transactions.
        </p>
      </div>
    </div>
  );
}
