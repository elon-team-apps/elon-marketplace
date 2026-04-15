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

function buildPocketFiReference(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `pfi_${Date.now()}_${rand}`;
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

function toEmailPasswordView(entry: string): string {
  const parts = String(entry).split(":");
  if (parts.length < 2) return entry;
  return `${parts[0]}:${parts[1]}`;
}

type PurchaseState =
  | { phase: "idle" }
  | { phase: "success"; logs: string[]; count: number }
  | { phase: "processing"; message: string }
  | { phase: "error"; message: string };

export function PurchaseModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { currentUser } = useApp();
  const [qty, setQty] = useState(1);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>({ phase: "idle" });
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    setQty(1);
    setPurchasing(false);
    setPurchaseState({ phase: "idle" });
  }, [product.id]);

  const availableStock = getAvailableStock(product);
  const maxQty = Math.min(availableStock, 10);
  const totalPrice = qty * product.price;
  const balance = currentUser?.wallet_balance ?? 0;
  const canAfford = balance >= totalPrice;
  const canBypassBalance = isSuperAdminEmail(currentUser?.email);
  const pocketfiPublicKey = (import.meta.env.NEXT_PUBLIC_POCKETFI_PUBLIC_KEY as string | undefined) || "";
  const hasPurchaseFunds = canAfford || canBypassBalance;
  const MIN_PAYMENT_NAIRA = 100;
  const meetsMinimum = Number.isFinite(totalPrice) && totalPrice >= MIN_PAYMENT_NAIRA;
  const canStartPayment =
    Boolean(currentUser?.email) && Number.isFinite(totalPrice) && totalPrice > 0 && meetsMinimum;
  const platform = PLATFORM_MAP[inferPlatformKey(product.title)];
  const canAttemptPurchase = availableStock > 0;

  const handlePurchase = async () => {
    setPurchasing(true);
    setPurchaseState({ phase: "idle" });
    try {
      if (canBypassBalance) {
        console.info("[PurchaseModal] Admin balance bypass active for test purchase.");
      }
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

      const reference = buildPocketFiReference();

      if (!reference) {
        setPurchaseState({
          phase: "error",
          message: "PocketFi did not return a transaction reference. Try again or contact support.",
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
      const callbackUrl = `${window.location.origin}/dashboard?payment=success`;
      const metadata = {
        totalAmount: naira,
        customerEmail: currentUser.email,
        productId: product.id,
        quantity: qty,
      };

      // Pending row in public.transactions (PocketFi webhook completes → status completed).
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
        const simulateRes = await fetch("/api/webhooks/pocketfi", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "x-admin-bypass": "true",
          },
          body: JSON.stringify({
            event: "payment.success",
            data: {
              reference,
              amount: naira,
              status: "success",
              metadata,
            },
          }),
        });
        if (!simulateRes.ok) {
          const msg = await simulateRes.text();
          setPurchaseState({
            phase: "error",
            message: `Admin bypass simulation failed.\n${msg}`,
          });
          setPurchasing(false);
          return;
        }
        const simulatePayload = (await simulateRes.json().catch(() => ({}))) as Record<string, unknown>;
        const delivered = extractDeliveredData(simulatePayload).map(toEmailPasswordView);
        setPurchaseState({ phase: "success", logs: delivered, count: delivered.length });
        setPurchasing(false);
        window.dispatchEvent(new CustomEvent("orders:refresh"));
        sonnerToast.success("Admin test purchase completed", {
          description: `Fulfillment executed for ${qty} item${qty === 1 ? "" : "s"}.`,
        });
        return;
      }

      if (!pocketfiPublicKey.trim()) {
        setPurchaseState({
          phase: "error",
          message: "PocketFi public key is missing. Set NEXT_PUBLIC_POCKETFI_PUBLIC_KEY.",
        });
        setPurchasing(false);
        return;
      }

      const payRes = await fetch("/api/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: naira,
          email: currentUser.email,
          reference,
          callbackUrl,
          metadata,
        }),
      });
      const payPayload = (await payRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!payRes.ok) {
        const msg = parseInvokeErrorPayload(payPayload);
        setPurchaseState({ phase: "error", message: msg });
        setPurchasing(false);
        return;
      }
      const payUrlRaw =
        typeof payPayload.checkoutUrl === "string"
          ? payPayload.checkoutUrl
          : typeof payPayload.checkout_url === "string"
            ? payPayload.checkout_url
            : typeof payPayload.authorization_url === "string"
              ? payPayload.authorization_url
              : "";
      const payUrl = String(payUrlRaw).trim();
      if (!payUrl) {
        setPurchaseState({ phase: "error", message: "PocketFi did not return a checkout URL." });
        setPurchasing(false);
        return;
      }

      setPurchaseState({ phase: "idle" });
      sonnerToast.success("Success", {
        description: `Opening PocketFi checkout for ₦${naira.toLocaleString()} (${qty} item${qty === 1 ? "" : "s"})…`,
      });
      window.setTimeout(() => {
        window.location.replace(payUrl);
      }, 150);
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
                <span style={{ color: TEXT_BLACK }}>Unit price</span>
                <span className="font-semibold" style={{ color: TEXT_BLACK }}>₦{product.price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: TEXT_BLACK }}>Quantity</span>
                <span className="font-semibold" style={{ color: TEXT_BLACK }}>× {qty}</span>
              </div>
              <div className="border-t border-slate-200 dark:border-white/10 pt-2.5">
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-sm" style={{ color: TEXT_BLACK }}>Total</span>
                  <span className="font-extrabold text-xl" style={{ color: TEXT_BLACK }}>
                    ₦{totalPrice.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5" style={{ color: TEXT_BLACK }}>
                <Wallet className="h-3 w-3 shrink-0" style={{ color: TEXT_BLACK }} /> Your balance
              </span>
              <span className="font-bold" style={{ color: TEXT_BLACK }}>
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
                  <div className="max-h-40 overflow-auto rounded-lg border border-emerald-200/70 dark:border-emerald-500/20 bg-white/60 dark:bg-black/20 px-2.5 py-2">
                    <pre className="text-xs whitespace-pre-wrap break-words font-mono text-emerald-900 dark:text-emerald-100 leading-relaxed">
                      {purchaseState.logs.join("\n")}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    No log data was returned in webhook response.
                  </p>
                )}
              </div>
            )}

            {!hasPurchaseFunds && availableStock > 0 && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Need ₦{(totalPrice - balance).toLocaleString()} more.{" "}
                <Link to={`/dashboard/wallet?amount=${Math.max(100, totalPrice - balance)}`} onClick={onClose} className="underline underline-offset-2 font-semibold" style={{ color: TEXT_BLACK }}>
                  Fund Wallet →
                </Link>
              </p>
            )}
            {!currentUser?.email && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Please log in to continue.
              </p>
            )}
            {availableStock > 0 && totalPrice > 0 && totalPrice < MIN_PAYMENT_NAIRA && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Minimum purchase amount is ₦100
              </p>
            )}

            <button
              type="button"
              onClick={handlePurchase}
              disabled={!canAttemptPurchase || purchasing || !hasPurchaseFunds || !canStartPayment || purchaseState.phase === "success"}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: BTN_NAVY,
                boxShadow: (!purchasing && hasPurchaseFunds) ? "0 4px 14px rgba(15,23,42,0.35)" : "none",
              }}
            >
              {purchasing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span className="text-white">Redirecting to Payment...</span>
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 text-white" />
                  <span className="text-white">
                    Purchase {qty} account{qty > 1 ? "s" : ""} · ₦{totalPrice.toLocaleString()}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
