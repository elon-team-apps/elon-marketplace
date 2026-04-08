import { useEffect, useState } from "react";
import { Wallet, Loader2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import {
  supabase,
  supabaseUrl as configuredSupabaseUrl,
  supabaseAnonKey as configuredAnonKey,
  supabaseProjectRefFromUrl,
} from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const PENDING_REF_KEY = "pocketfi_pending_reference";
/** Client-approved primary actions (Purchase / Continue) */
const BTN_NAVY = "#0f172a";

/** Accept checkout_url from Edge Function or nested gateway payloads */
function extractPocketFiCheckoutUrl(payload: Record<string, unknown>): string | undefined {
  const pick = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    return /^https?:\/\//i.test(s) ? s : undefined;
  };

  const direct = pick(payload.checkout_url) ?? pick(payload.checkoutUrl);
  if (direct) return direct;

  const data = payload.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    return (
      pick(d.checkout_url) ??
      pick(d.checkoutUrl) ??
      pick(d.authorization_url) ??
      pick(d.payment_url) ??
      pick(d.link) ??
      pick(d.url)
    );
  }
  return undefined;
}

function supabaseProjectRefFromJwt(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
    const payload = JSON.parse(atob(padded)) as { iss?: string };
    const iss = payload.iss;
    if (!iss) return null;
    const m = iss.match(/https?:\/\/([^.]+)\.supabase\.co\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [amount, setAmount] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showDeployPrompt, setShowDeployPrompt] = useState(false);
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
    setShowDeployPrompt(false);
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

      const baseUrl = configuredSupabaseUrl;
      const anonKey = configuredAnonKey;
      if (!baseUrl || !anonKey) {
        throw new Error("App configuration error: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
      }

      // Fresh access token — gateway 401 "Invalid JWT" is often an expired session.
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      let accessToken = refreshData.session?.access_token;
      if (refreshError || !accessToken) {
        const { data: fallback } = await supabase.auth.getSession();
        accessToken = fallback.session?.access_token;
      }
      if (!accessToken) {
        throw new Error("Your session expired. Please sign out and sign in again, then retry.");
      }

      const urlRef = supabaseProjectRefFromUrl(baseUrl);
      const jwtRef = supabaseProjectRefFromJwt(accessToken);
      if (urlRef && jwtRef && urlRef !== jwtRef) {
        console.error("[Wallet] JWT vs VITE_SUPABASE_URL project mismatch:", { urlRef, jwtRef });
        throw new Error(
          "Your login session does not match this app build (Invalid JWT). Sign out, sign in again, and verify Vercel uses the same Supabase URL + anon key as your project."
        );
      }

      const reference = `PM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const callbackUrl = `${window.location.origin}/dashboard/wallet`;
      const fnUrl = `${baseUrl.replace(/\/$/, "")}/functions/v1/pocketfi-init`;
      const EDGE_TIMEOUT_MS = 20000;

      const callPocketFiInit = async (token: string) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);
        const resp = await fetch(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({
            amount: naira,
            email: currentUser.email,
            reference,
            callbackUrl,
          }),
          signal: controller.signal,
        });
        try {
          const rawText = await resp.text();
          let payload: Record<string, unknown> = {};
          try {
            payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
          } catch {
            payload = { _parseError: rawText };
          }
          return { resp, payload };
        } finally {
          window.clearTimeout(timeoutId);
        }
      };

      const callVercelPayProxy = async () => {
        const proxyResp = await fetch("/api/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: naira,
            email: currentUser.email,
            reference,
            callbackUrl,
          }),
        });
        const rawText = await proxyResp.text();
        let proxyPayload: Record<string, unknown> = {};
        try {
          proxyPayload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        } catch {
          proxyPayload = { _parseError: rawText };
        }
        return { proxyResp, proxyPayload };
      };

      let { resp, payload } = await callPocketFiInit(accessToken);
      if (resp.status === 401) {
        const { data: again } = await supabase.auth.refreshSession();
        const t2 = again.session?.access_token;
        if (t2 && t2 !== accessToken) {
          ({ resp, payload } = await callPocketFiInit(t2));
        }
      }

      console.log("PocketFi Response:", { status: resp.status, ok: resp.ok, payload });

      let checkoutUrl = extractPocketFiCheckoutUrl(payload);

      // Fallback path: if Supabase edge route timed out, try Vercel server proxy (/api/pay).
      if (!checkoutUrl && !resp.ok && resp.status === 504) {
        try {
          const { proxyResp, proxyPayload } = await callVercelPayProxy();
          if (proxyResp.ok) {
            const fromProxy =
              (typeof proxyPayload.checkoutUrl === "string" && proxyPayload.checkoutUrl) ||
              (typeof proxyPayload.checkout_url === "string" && proxyPayload.checkout_url);
            if (fromProxy && /^https?:\/\//i.test(fromProxy)) {
              checkoutUrl = fromProxy;
            }
          }
        } catch {
          // keep original edge failure message path below
        }
      }

      if (!resp.ok || !checkoutUrl) {
        const fromBody =
          (typeof payload.error === "string" && payload.error) ||
          (typeof payload.message === "string" && payload.message);
        let message =
          fromBody ||
          (resp.status === 401
            ? "Session not accepted by server. Sign out, clear site data for this site, sign in again."
            : `Could not initialize PocketFi checkout (${resp.status}).`);
        if (resp.status === 401 && /invalid jwt/i.test(String(fromBody ?? ""))) {
          message =
            "Supabase rejected your session token (Invalid JWT). Sign out, sign in again. In Vercel, confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY both belong to project " +
            (urlRef ?? "your Supabase project") +
            ".";
        }
        if (/failed to send a request|fetch|load failed/i.test(message)) {
          message =
            "Network error calling PocketFi. Confirm `pocketfi-init` is deployed and CORS allows this origin.";
        }
        if (resp.status === 504 || /timed out while trying/i.test(String(fromBody ?? ""))) {
          setShowDeployPrompt(true);
        }
        if (/invalid jwt/i.test(String(fromBody ?? "")) && /pocketfi error/i.test(String(fromBody ?? ""))) {
          message =
            "PocketFi rejected the server secret. Set POCKETFI_SECRET_KEY in Supabase Edge Function secrets to the exact key from the PocketFi dashboard.";
        }
        const hint = typeof payload.hint === "string" ? payload.hint.trim() : "";
        if (hint) message = `${message} ${hint}`;
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

      // Immediate handover: only `replace` (never assign/href/router) so checkout opens in-tab
      // without a wallet history entry — Back from PocketFi skips the broken intermediate step.
      const handoverUrl = checkoutUrl.trim();
      window.location.replace(handoverUrl);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start PocketFi checkout.";
      const friendly = /aborted|timeout|load failed|failed to fetch|networkerror/i.test(msg)
        ? "PocketFi is taking too long to respond. Please try again. If this keeps happening, verify `POCKETFI_INIT_URL`, `POCKETFI_API_KEY`, and `POCKETFI_SECRET_KEY` in Supabase secrets."
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
            <p className="text-sm font-medium text-black dark:text-white">Available Balance</p>
            <p className="font-heading text-3xl font-bold text-black dark:text-white">
              ₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {pendingRef && pendingStatus !== "completed" && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 dark:border-amber-500/35">
          Payment pending verification... we are waiting for PocketFi webhook confirmation.
        </div>
      )}

      <div className="glass-card p-6 space-y-5">
        {showDeployPrompt && (
          <div className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
            Developer action needed: push latest code and redeploy `pocketfi-init` before testing checkout again.
          </div>
        )}
        <h2 className="font-heading font-semibold text-lg text-black dark:text-white">
          Fund Wallet with PocketFi
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
            onClick={startPocketFiCheckout}
            disabled={checkoutLoading || !amount || parseInt(amount) < 100}
          >
            {checkoutLoading ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white" />
                <span className="text-white">Redirecting to PocketFi…</span>
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4 shrink-0 text-white" />
                <span className="text-white">Continue to PocketFi</span>
              </>
            )}
          </button>
        ) : (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 dark:border-amber-500/35">
            PocketFi is currently disabled by admin.
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
            "Click Continue to PocketFi to complete payment.",
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
          Manual receipt uploads are disabled. Use PocketFi for all wallet funding transactions.
        </p>
      </div>
    </div>
  );
}
