import { useState, useEffect } from "react";
import {
  X, Eye, AlertCircle, Loader2, Minus, Plus, Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { useApp, type Product } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { isSuperAdminEmail } from "@/lib/adminAccess";
import {
  formatSupabasePostgrestError,
  isLikelySchemaOrMissingColumnError,
} from "@/lib/supabaseErrors";
import { toast as sonnerToast } from "sonner";
import {
  PlatformLogo,
  PLATFORM_MAP,
  inferPlatformKey,
  getAvailableStock,
} from "@/pages/ProductsPage";

const BTN_NAVY = "#0f172a";
const TEXT_BLACK = "#000000";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatRpcResultPayload(payload: Record<string, unknown> | null): string {
  if (!payload || payload.success !== false) return "";
  const lines: string[] = [];
  if (typeof payload.message === "string" && payload.message) lines.push(`message: ${payload.message}`);
  if (typeof payload.code === "string" && payload.code) lines.push(`code: ${payload.code}`);
  if (typeof payload.sqlstate === "string" && payload.sqlstate) lines.push(`SQLSTATE ${payload.sqlstate}`);
  try {
    lines.push(`response (full): ${JSON.stringify(payload)}`);
  } catch {
    /* ignore */
  }
  return lines.join("\n");
}

function formatAuthSessionError(err: { message?: string; name?: string } | null): string {
  if (!err?.message) return "No active session. Sign in again.";
  const parts = [`message: ${err.message}`];
  if (err.name) parts.push(`name: ${err.name}`);
  return parts.join("\n");
}

/** When PostgREST complains about columns/schema, log what the API exposes for `transactions`. */
async function logTransactionsInsertDebug(
  client: SupabaseClient,
  insertPayload: Record<string, unknown>,
  insertError: PostgrestError,
) {
  console.error("[PurchaseModal] transactions.insert failed", { insertPayload, insertError });
  if (!isLikelySchemaOrMissingColumnError(insertError)) return;
  const probe = await client.from("transactions").select("*").limit(1);
  console.error(
    "[PurchaseModal] public.transactions PostgREST probe (keys from first row, or select error):",
    {
      selectError: probe.error ? formatSupabasePostgrestError(probe.error) : null,
      sampleRowColumnKeys:
        Array.isArray(probe.data) && probe.data[0] ? Object.keys(probe.data[0] as object) : [],
      rowCount: probe.data?.length ?? 0,
    },
  );
}

/** Combines reserve RPC + direct insert failures so you see RLS / missing table / duplicate ref, etc. */
function formatReserveFailure(
  rpcErr: PostgrestError | null,
  rpcPayload: Record<string, unknown> | null,
  insertErr: PostgrestError | null,
): string {
  const blocks: string[] = [];
  const rpcHttp = formatSupabasePostgrestError(rpcErr);
  if (rpcHttp) blocks.push(`reserve_purchase_transaction (RPC):\n${rpcHttp}`);
  const rpcBody = formatRpcResultPayload(rpcPayload);
  if (rpcBody) blocks.push(`reserve_purchase_transaction (response):\n${rpcBody}`);
  const ins = formatSupabasePostgrestError(insertErr);
  if (ins) blocks.push(`transactions.insert (RLS / client):\n${ins}`);
  return blocks.length > 0
    ? blocks.join("\n\n— — —\n\n")
    : "Could not save a pending purchase row to public.transactions.";
}

function parseInvokeErrorPayload(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof payload.code === "string" && payload.code) parts.push(`code: ${payload.code}`);
  if (typeof payload.error === "string" && payload.error) parts.push(`error: ${payload.error}`);
  if (typeof payload.detail === "string" && payload.detail) parts.push(`detail: ${payload.detail}`);
  if (typeof payload.message === "string" && payload.message) parts.push(`message: ${payload.message}`);
  try {
    parts.push(`response (full): ${JSON.stringify(payload)}`);
  } catch {
    /* ignore */
  }
  return parts.filter(Boolean).join("\n") || "Unable to start payment.";
}

function buildPaymentReference(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `psk_${Date.now()}_${rand}`;
}

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

function extractDeliveredData(payload: Record<string, unknown>): string[] {
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const raw = data.delivered_data;
  if (typeof raw === "string") {
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeDeliveredLog(entry: string): string {
  return String(entry ?? "")
    .split(":")
    .map((part) => part.trim())
    .join(":")
    .trim();
}

type PurchaseState =
  | { phase: "idle" }
  | { phase: "success"; logs: string[]; count: number }
  | { phase: "processing"; message: string }
  | { phase: "error"; message: string };

export function PurchaseModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { currentUser, refreshProfile } = useApp();
  const [qty, setQty] = useState(1);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>({ phase: "idle" });
  const [purchasing, setPurchasing] = useState(false);
  const [showPaystackOption, setShowPaystackOption] = useState(false);
  const [copiedLog, setCopiedLog] = useState<string | null>(null);

  useEffect(() => {
    setQty(1);
    setPurchasing(false);
    setPurchaseState({ phase: "idle" });
    setShowPaystackOption(false);
  }, [product.id]);

  const availableStock = getAvailableStock(product);
  const maxQty = Math.min(availableStock, 10);
  const totalPrice = qty * product.price;
  const totalAmountKobo = Math.trunc(totalPrice * 100);
  const balance = currentUser?.wallet_balance ?? 0;
  const canAfford = balance >= totalPrice;
  const canBypassBalance = isSuperAdminEmail(currentUser?.email);
  const paystackPublicKey = (import.meta.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY as string | undefined) || "";
  const canUseWallet = canAfford;
  const MIN_PAYMENT_NAIRA = 100;
  const meetsMinimum = Number.isFinite(totalPrice) && totalPrice >= MIN_PAYMENT_NAIRA;
  const canStartPayment =
    Boolean(currentUser?.email) && Number.isFinite(totalPrice) && totalPrice > 0 && meetsMinimum;
  const platform = PLATFORM_MAP[inferPlatformKey(product.title)];
  const canAttemptPurchase = availableStock > 0;

  const copyLogLine = async (line: string) => {
    try {
      await navigator.clipboard.writeText(line);
      setCopiedLog(line);
      window.setTimeout(() => setCopiedLog((prev) => (prev === line ? null : prev)), 2000);
    } catch (error) {
      console.error("[PurchaseModal] Failed to copy delivered log", error);
    }
  };

  const pollTransactionDelivery = async (reference: string) => {
    if (!supabase || !currentUser?.id) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data, error } = await supabase
        .from("transactions")
        .select("status, delivered_data")
        .eq("reference", reference)
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (!error && data) {
        const status = String(data.status ?? "").toLowerCase();
        const delivered = extractDeliveredData(data as Record<string, unknown>).map(normalizeDeliveredLog);
        if (status === "completed" && delivered.length > 0) {
          setPurchaseState({ phase: "success", logs: delivered, count: delivered.length });
          window.dispatchEvent(new CustomEvent("orders:refresh"));
          await refreshProfile();
          return true;
        }
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
    }
    return false;
  };

  const handleWalletPurchase = async () => {
    setPurchasing(true);
    setPurchaseState({ phase: "idle" });
    try {
      if (!supabase || !currentUser?.email) {
        setPurchaseState({ phase: "error", message: "Please log in to continue." });
        setPurchasing(false);
        return;
      }
      if (!canUseWallet) {
        setPurchaseState({ phase: "error", message: "Insufficient wallet balance for this purchase." });
        setPurchasing(false);
        return;
      }
      if (!UUID_REGEX.test(product.id)) {
        setPurchaseState({
          phase: "error",
          message: "This product cannot be purchased online. Please refresh the catalogue and try again.",
        });
        setPurchasing(false);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        setPurchaseState({
          phase: "error",
          message: formatAuthSessionError(sessionError ?? null),
        });
        setPurchasing(false);
        return;
      }

      setPurchaseState({ phase: "processing", message: "Paying with wallet and delivering your order..." });
      const walletRes = await fetch("/api/wallet-purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          productId: product.id,
          quantity: qty,
        }),
      });
      const walletPayload = (await walletRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!walletRes.ok) {
        const message =
          (typeof walletPayload.error === "string" && walletPayload.error) ||
          "Wallet purchase failed.";
        setPurchaseState({ phase: "error", message });
        setPurchasing(false);
        return;
      }

      const delivered = extractDeliveredData(walletPayload).map(normalizeDeliveredLog);
      setPurchaseState({ phase: "success", logs: delivered, count: delivered.length });
      window.dispatchEvent(new CustomEvent("orders:refresh"));
      await refreshProfile();
      sonnerToast.success("Wallet payment completed", {
        description: `Delivered ${qty} account${qty === 1 ? "" : "s"} instantly.`,
      });
    } catch (e) {
      console.error("[PurchaseModal] Wallet purchase error", e);
      setPurchaseState({
        phase: "error",
        message: e instanceof Error ? e.message : "Wallet purchase failed.",
      });
    } finally {
      setPurchasing(false);
    }
  };

  const handlePaystackPurchase = async () => {
    setPurchasing(true);
    setPurchaseState({ phase: "idle" });
    try {
      if (!supabase || !currentUser?.email) {
        setPurchaseState({ phase: "error", message: "Please log in to continue." });
        setPurchasing(false);
        return;
      }
      if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
        setPurchaseState({ phase: "error", message: "Invalid purchase amount. Please try again." });
        setPurchasing(false);
        return;
      }
      if (!Number.isFinite(totalAmountKobo) || totalAmountKobo <= 0) {
        setPurchaseState({ phase: "error", message: "Invalid Paystack amount. Please try again." });
        setPurchasing(false);
        return;
      }
      if (totalPrice < MIN_PAYMENT_NAIRA) {
        setPurchaseState({ phase: "error", message: "Minimum purchase amount is ₦100" });
        setPurchasing(false);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        setPurchaseState({
          phase: "error",
          message: formatAuthSessionError(sessionError ?? null),
        });
        setPurchasing(false);
        return;
      }

      const reference = buildPaymentReference();

      if (!reference) {
        setPurchaseState({
          phase: "error",
          message: "Paystack did not return a transaction reference. Try again or contact support.",
        });
        setPurchasing(false);
        return;
      }

      if (!UUID_REGEX.test(product.id)) {
        setPurchaseState({
          phase: "error",
          message: "This product cannot be purchased online. Please refresh the catalogue and try again.",
        });
        setPurchasing(false);
        return;
      }

      const naira = Math.trunc(totalPrice);
      const metadata = {
        productId: product.id,
        quantity: qty,
        buyerEmail: currentUser.email,
      };

      const callbackUrl = `${window.location.origin}/dashboard?payment=success`;
      const paystackMetadata = {
        productId: product.id,
        quantity: qty,
        buyerEmail: currentUser.email,
      };

      // Pending row in public.transactions (Paystack webhook completes → status completed).
      // Prefer SECURITY DEFINER RPC so reservation works even when direct INSERT is blocked by RLS.
      const { data: reserveData, error: reserveRpcErr } = await supabase.rpc("reserve_purchase_transaction", {
        p_reference: reference,
        p_amount: naira,
        p_product_id: product.id,
        p_quantity: qty,
      });

      const reservePayload = (reserveData ?? null) as Record<string, unknown> | null;
      const rpcOk = !reserveRpcErr && reservePayload?.success === true;

      if (!rpcOk) {
        const txInsertPayload = {
          user_id: currentUser.id,
          amount: naira,
          type: "purchase" as const,
          status: "pending" as const,
          reference,
          product_id: product.id,
          quantity: qty,
        };
        const { error: txError } = await supabase.from("transactions").insert(txInsertPayload);

        if (txError) {
          await logTransactionsInsertDebug(supabase, txInsertPayload, txError);
          setPurchaseState({
            phase: "error",
            message: formatReserveFailure(reserveRpcErr, reservePayload, txError),
          });
          setPurchasing(false);
          return;
        }
      }

      if (canBypassBalance) {
        const simulateRes = await fetch("/api/webhooks/paystack", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "x-admin-bypass": "true",
          },
          body: JSON.stringify({
            event: "charge.success",
            data: {
              reference,
              amount: totalAmountKobo,
              status: "success",
              metadata,
            },
          }),
        });
        if (!simulateRes.ok) {
          const msg = await simulateRes.text();
          setPurchaseState({
            phase: "error",
            message: `Paystack simulation failed.\n${msg}`,
          });
          setPurchasing(false);
          return;
        }
        const simulatePayload = (await simulateRes.json().catch(() => ({}))) as Record<string, unknown>;
        const delivered = extractDeliveredData(simulatePayload).map(normalizeDeliveredLog);
        setPurchaseState({ phase: "success", logs: delivered, count: delivered.length });
        window.dispatchEvent(new CustomEvent("orders:refresh"));
        await refreshProfile();
        sonnerToast.success("Purchase completed", {
          description: `Fulfillment executed for ${qty} item${qty === 1 ? "" : "s"}.`,
        });
        setPurchasing(false);
        return;
      }

      if (!paystackPublicKey.trim()) {
        const msg = "Paystack public key is missing. Set NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY.";
        console.error("[PurchaseModal] Paystack init failed: missing NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY");
        setPurchaseState({ phase: "error", message: msg });
        sonnerToast.error("Paystack initialization failed", {
          description: msg,
        });
        setPurchasing(false);
        return;
      }

      setPurchaseState({ phase: "processing", message: "Initializing Paystack popup..." });
      sonnerToast.success("Opening Paystack", {
        description: `Opening Paystack popup for ₦${naira.toLocaleString()} (${qty} item${qty === 1 ? "" : "s"})…`,
      });

      const PaystackPop = await loadPaystackInlineScript();
      console.log("[PurchaseModal] Paystack popup ready", {
        hasPopup: Boolean(PaystackPop),
        keyPrefix: paystackPublicKey.trim().slice(0, 7),
        reference,
      });
      const handler = PaystackPop.setup({
        key: paystackPublicKey.trim(),
        email: currentUser.email,
        amount: totalAmountKobo,
        ref: reference,
        metadata: paystackMetadata,
        callback: () => {
          setPurchaseState({
            phase: "processing",
            message: "Payment received. Fetching your credentials...",
          });
          void (async () => {
            const resolved = await pollTransactionDelivery(reference);
            if (!resolved) {
              setPurchaseState({
                phase: "processing",
                message: "Payment confirmed. Fetching credentials...",
              });
              window.location.assign(callbackUrl);
            }
          })();
        },
        onClose: () => {
          setPurchasing(false);
          setPurchaseState({ phase: "idle" });
        },
      });
      handler.openIframe();
      setPurchasing(false);
      return;
    } catch (e) {
      let msg = "Unable to start payment.";
      if (e instanceof Error) {
        msg = `message: ${e.message}`;
        const any = e as Error & { code?: string };
        if (any.code) msg = `code: ${any.code}\n${msg}`;
      } else if (e && typeof e === "object") {
        try {
          msg = `message: ${JSON.stringify(e)}`;
        } catch {
          msg = String(e);
        }
      }
      console.error("[PurchaseModal] Paystack initialization error", e);
      setPurchaseState({ phase: "error", message: msg });
      setPurchasing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden bg-white dark:bg-[#0a0e1a] shadow-2xl"
        style={{ border: "1px solid rgba(0,0,0,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/7">
            <div className="flex items-center gap-3">
              <PlatformLogo product={product} platform={platform} size={35} />
              <div>
                <h3 className="font-bold text-sm leading-tight pr-2 line-clamp-1 text-white">{product.title}</h3>
                <p className="text-[11px] mt-0.5 text-gray-100">
                  {availableStock} available · {platform?.label ?? product.category}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:text-white/35 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/8 transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-white">Select Quantity</p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  className="h-10 w-10 rounded-xl border border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-30"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="flex-1 text-center">
                  <span className="font-bold text-3xl text-white">{qty}</span>
                  <span className="text-sm ml-2 text-gray-100">account{qty > 1 ? "s" : ""}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={qty >= maxQty}
                  className="h-10 w-10 rounded-xl border border-slate-400 dark:border-slate-500 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white flex items-center justify-center hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {maxQty >= 3 && (
                <div className="flex gap-2 mt-3">
                  {[1, 2, 3, 5, 10].filter((n) => n <= maxQty).map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setQty(n)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 ${
                        qty === n
                          ? "border-2 bg-white dark:bg-white/5"
                          : "border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/4"
                      }`}
                      style={qty === n ? { color: TEXT_BLACK, borderColor: BTN_NAVY } : { color: TEXT_BLACK }}
                    >
                      ×{n}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl p-4 space-y-2.5 bg-slate-50 dark:bg-white/3 border border-slate-200 dark:border-white/7">
              <div className="flex justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">Unit price</span>
                <span className="font-semibold text-slate-900 dark:text-white">₦{product.price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200">Quantity</span>
                <span className="font-semibold text-slate-900 dark:text-white">× {qty}</span>
              </div>
              <div className="border-t border-slate-200 dark:border-white/10 pt-2.5">
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-sm text-slate-900 dark:text-white">Total</span>
                  <span className="font-extrabold text-xl text-slate-900 dark:text-white">
                    ₦{totalPrice.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <Wallet className="h-3 w-3 shrink-0" /> Your balance
              </span>
              <span className="font-bold text-slate-900 dark:text-white">
                ₦{balance.toLocaleString()}
              </span>
            </div>

            {purchaseState.phase === "error" && (
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap break-words font-mono flex-1 min-w-0 leading-relaxed">
                  {purchaseState.message}
                </pre>
              </div>
            )}
            {purchaseState.phase === "processing" && (
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20">
                <Loader2 className="h-4 w-4 text-sky-500 mt-0.5 shrink-0 animate-spin" />
                <p className="text-sm text-sky-700 dark:text-sky-300">{purchaseState.message}</p>
              </div>
            )}
            {purchaseState.phase === "success" && (
              <div className="rounded-xl px-4 py-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 space-y-2.5">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Purchase completed ({purchaseState.count} account{purchaseState.count === 1 ? "" : "s"})
                </p>
                {purchaseState.logs.length > 0 ? (
                  <div className="max-h-56 overflow-auto rounded-lg border border-emerald-200/70 dark:border-emerald-500/20 bg-white/60 dark:bg-black/20 px-2.5 py-2 space-y-2">
                    {purchaseState.logs.map((logLine, index) => (
                      <div
                        key={`${logLine}-${index}`}
                        className="flex items-start justify-between gap-2 rounded-md border border-emerald-200/70 bg-white/70 px-2 py-2 dark:border-emerald-500/10 dark:bg-black/20"
                      >
                        <pre className="text-xs whitespace-pre-wrap break-all font-mono text-emerald-900 dark:text-emerald-100 leading-relaxed flex-1 min-w-0">
                          {logLine}
                        </pre>
                        <button
                          type="button"
                          onClick={() => void copyLogLine(logLine)}
                          className="shrink-0 rounded-md border border-emerald-300/80 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/20 dark:text-emerald-200 dark:hover:bg-emerald-500/10"
                        >
                          {copiedLog === logLine ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    No log data was returned in webhook response.
                  </p>
                )}
              </div>
            )}

            {!canUseWallet && !canBypassBalance && availableStock > 0 && (
              <p className="text-xs text-center text-slate-700 dark:text-slate-200">
                Need ₦{(totalPrice - balance).toLocaleString()} more.{" "}
                <Link to={`/dashboard/wallet?amount=${Math.max(100, totalPrice - balance)}`} onClick={onClose} className="underline underline-offset-2 font-semibold text-slate-900 dark:text-white">
                  Fund Wallet →
                </Link>
              </p>
            )}
            {!currentUser?.email && (
              <p className="text-xs text-center text-slate-700 dark:text-slate-200">
                Please log in to continue.
              </p>
            )}
            {availableStock > 0 && totalPrice > 0 && totalPrice < MIN_PAYMENT_NAIRA && (
              <p className="text-xs text-center text-slate-700 dark:text-slate-200">
                Minimum purchase amount is ₦100
              </p>
            )}
            {canUseWallet ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleWalletPurchase}
                  disabled={!canAttemptPurchase || purchasing || purchaseState.phase === "success"}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: BTN_NAVY,
                    boxShadow: !purchasing ? "0 4px 14px rgba(15,23,42,0.35)" : "none",
                  }}
                >
                  {purchasing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span className="text-white">
                        {purchaseState.phase === "processing" ? "Processing wallet payment..." : "Preparing wallet checkout..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4 text-white" />
                      <span className="text-white">
                        Pay with Wallet · ₦{totalPrice.toLocaleString()}
                      </span>
                    </>
                  )}
                </button>
                {!showPaystackOption && (
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <Link
                      to={`/dashboard/wallet?amount=${Math.max(100, totalPrice)}`}
                      onClick={onClose}
                      className="font-semibold text-slate-700 underline underline-offset-2 dark:text-slate-200"
                    >
                      Top up wallet
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowPaystackOption(true)}
                      className="font-semibold text-slate-700 underline underline-offset-2 dark:text-slate-200"
                    >
                      Use Paystack instead
                    </button>
                  </div>
                )}
              </div>
            ) : null}
            {(!canUseWallet || showPaystackOption || canBypassBalance) && (
              <button
                type="button"
                onClick={handlePaystackPurchase}
                disabled={!canAttemptPurchase || purchasing || (!canStartPayment && !canBypassBalance) || purchaseState.phase === "success"}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: BTN_NAVY,
                  boxShadow: (!purchasing && canStartPayment) ? "0 4px 14px rgba(15,23,42,0.35)" : "none",
                }}
              >
                {purchasing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                    <span className="text-white">
                      {purchaseState.phase === "processing" ? "Initializing Paystack..." : "Preparing Payment..."}
                    </span>
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 text-white" />
                    <span className="text-white">
                      Pay with Paystack · ₦{totalPrice.toLocaleString()}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
