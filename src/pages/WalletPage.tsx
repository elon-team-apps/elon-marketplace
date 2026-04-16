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

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const PENDING_REF_KEY = "paystack_pending_reference";
const LEGACY_PENDING_REF_KEY = "pocketfi_pending_reference";
/** Client-approved primary actions (Purchase / Continue) */
const BTN_NAVY = "#0f172a";

type PaystackHandler = {
  openIframe: () => void;
};

type PaystackPopup = {
  setup: (options: {
    key: string;
    email: string;
    amount: number;
    ref: string;
    metadata?: Record<string, unknown>;
    callback?: (response: { reference?: string; [key: string]: unknown }) => void;
    onClose?: () => void;
  }) => PaystackHandler;
};

type PaystackWindow = Window & {
  PaystackPop?: PaystackPopup;
};

function getPaystackWindow(): PaystackWindow {
  return window as PaystackWindow;
}

async function loadPaystackInlineScript(): Promise<PaystackPopup> {
  const existing = getPaystackWindow().PaystackPop;
  if (existing) return existing;

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-paystack-inline="true"]');
    if (existingScript) {
      if (getPaystackWindow().PaystackPop) {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Paystack inline script.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    script.dataset.paystackInline = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Paystack inline script."));
    document.body.appendChild(script);
  });

  const popup = getPaystackWindow().PaystackPop;
  if (!popup) {
    throw new Error("Paystack inline popup is unavailable.");
  }
  return popup;
}

function buildPaymentReference(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `psk_wallet_${Date.now()}_${rand}`;
}

type PaymentMethodSettingsRow = {
  pocketfi_enabled: boolean;
  manual_enabled: boolean;
};

type PaymentMethodSettings = {
  paystackEnabled: boolean;
  manualEnabled: boolean;
};

function mapPaymentSettings(row: PaymentMethodSettingsRow | null | undefined): PaymentMethodSettings {
  return {
    paystackEnabled: Boolean(row?.pocketfi_enabled),
    manualEnabled: Boolean(row?.manual_enabled),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const [searchParams] = useSearchParams();
  const { currentUser, refreshProfile } = useApp();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<"pending" | "completed" | "failed" | null>(null);
  const [methods, setMethods] = useState<PaymentMethodSettings>({ paystackEnabled: true, manualEnabled: false });
  const paystackPublicKey = (import.meta.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY as string | undefined) || "";

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
        if (data) setMethods(mapPaymentSettings(data as PaymentMethodSettingsRow));
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

  // ── Start Paystack checkout (inline popup + webhook verification) ──────────
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

      if (!paystackPublicKey.trim()) {
        console.error("[WalletPage] Paystack init failed: missing NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY");
        throw new Error("Missing Key: NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY");
      }

      const paystackRef = buildPaymentReference();

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
      setPendingRef(paystackRef);
      setPendingStatus("pending");

      const PaystackPop = await loadPaystackInlineScript();
      console.log("[WalletPage] Paystack popup ready", {
        hasPopup: Boolean(PaystackPop),
        keyPrefix: paystackPublicKey.trim().slice(0, 7),
        reference: paystackRef,
        amountKobo: naira * 100,
      });

      const handler = PaystackPop.setup({
        key: paystackPublicKey.trim(),
        email: currentUser.email,
        amount: naira * 100,
        ref: paystackRef,
        metadata: {
          transactionType: "deposit",
          buyerEmail: currentUser.email,
          userId: currentUser.id,
          amountNaira: naira,
        },
        callback: (response) => {
          const resolvedRef =
            typeof response.reference === "string" && response.reference.trim()
              ? response.reference.trim()
              : paystackRef;
          console.log("[WalletPage] Paystack callback received", { reference: resolvedRef });
          localStorage.setItem(PENDING_REF_KEY, resolvedRef);
          setPendingRef(resolvedRef);
          setPendingStatus("pending");
          toast({
            title: "Payment received",
            description: "Waiting for Paystack confirmation to update your wallet.",
          });
        },
        onClose: () => {
          setCheckoutLoading(false);
        },
      });

      handler.openIframe();
      setCheckoutLoading(false);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start Paystack checkout.";
      console.error("[WalletPage] Paystack initialization error", err);
      const friendly = /missing key/i.test(msg)
        ? "Paystack public key is missing. Set `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`."
        : /script|popup is unavailable|load/i.test(msg)
          ? "Paystack script not loaded. Refresh and try again."
          : /aborted|timeout|load failed|failed to fetch|networkerror/i.test(msg)
            ? "Paystack is taking too long to respond. Please try again."
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
        {methods.paystackEnabled ? (
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

        {!methods.manualEnabled && (
          <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-black dark:border-white/40 dark:bg-slate-800/80 dark:text-white">
            Manual transfer is currently disabled by admin.
          </div>
        )}
        {methods.manualEnabled && (
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
