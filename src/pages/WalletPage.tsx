import { useEffect, useState } from "react";
import { Wallet, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const PENDING_REF_KEY = "pocketfi_pending_reference";

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
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
    const stored = localStorage.getItem(PENDING_REF_KEY);
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
  }, [pendingRef, currentUser?.id, toast]);

  // ── Start PocketFi checkout ────────────────────────────────────────────────
  const startPocketFiCheckout = async () => {
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

      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let accessToken = sessionData.session?.access_token;
      if (!accessToken && !sessionError) {
        const refreshed = await supabase.auth.refreshSession();
        sessionData = refreshed.data;
        sessionError = refreshed.error;
        accessToken = sessionData.session?.access_token;
      }
      if (sessionError || !accessToken) {
        throw new Error("Your session expired. Please sign out and sign in again, then retry.");
      }

      const reference = `PM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callbackUrl = `${window.location.origin}/dashboard/wallet`;

      // Call Edge Function via fetch with BOTH apikey + user JWT. Passing only
      // Authorization to `functions.invoke` can drop the anon apikey header and
      // yield 401 + null data at the gateway.
      const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (!baseUrl || !anonKey) {
        throw new Error("App configuration error: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
      }
      const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/pocketfi-init`;
      const resp = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          amount: naira,
          email: currentUser.email,
          reference,
          callbackUrl,
        }),
      });

      const rawText = await resp.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        payload = { _parseError: rawText };
      }
      console.log("PocketFi Response:", { status: resp.status, ok: resp.ok, payload });

      const checkoutUrl =
        (typeof payload.checkout_url === "string" ? payload.checkout_url : undefined) ??
        (typeof payload.checkoutUrl === "string" ? payload.checkoutUrl : undefined);

      if (!resp.ok || !checkoutUrl) {
        const fromBody =
          (typeof payload.error === "string" && payload.error) ||
          (typeof payload.message === "string" && payload.message);
        let message =
          fromBody ||
          (resp.status === 401
            ? "Session not accepted by server. Sign out, sign in again, then retry."
            : `Could not initialize PocketFi checkout (${resp.status}).`);
        if (/failed to send a request|fetch|load failed/i.test(message)) {
          message =
            "Network error calling PocketFi. Confirm `pocketfi-init` is deployed and CORS allows this origin.";
        }
        throw new Error(message);
      }

      // Persist pending deposit transaction before redirect so webhook can reconcile.
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: currentUser.id,
        amount: naira,
        type: "deposit",
        status: "pending",
        reference,
      });

      if (txError) {
        throw new Error(`Could not create pending transaction: ${txError.message}`);
      }
      localStorage.setItem(PENDING_REF_KEY, reference);

      window.location.href = checkoutUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start PocketFi checkout.";
      const friendly = /load failed|failed to fetch|networkerror/i.test(msg)
        ? "Network request failed while contacting PocketFi. Please check your internet and ensure `pocketfi-init` is deployed."
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

      {pendingRef && pendingStatus !== "completed" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Payment pending verification... we are waiting for PocketFi webhook confirmation.
        </div>
      )}

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
        {methods.pocketfi_enabled ? (
          <Button
            className="w-full gap-2 text-white"
            style={{ background: "#0f172a" }}
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
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            PocketFi is currently disabled by admin.
          </div>
        )}

        {!methods.manual_enabled && (
          <div className="rounded-lg border border-slate-400/30 bg-slate-500/10 px-3 py-2 text-xs text-slate-300">
            Manual transfer is currently disabled by admin.
          </div>
        )}
        {methods.manual_enabled && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            Manual transfer is enabled. Contact support for manual funding instructions.
          </div>
        )}
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
