import { useState, useEffect } from "react";
import {
  X, Eye, AlertCircle, Loader2, Minus, Plus, Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useApp, type Product } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { extractPaystackRedirectUrl } from "@/lib/paystackRedirect";
import {
  PlatformLogo,
  PLATFORM_MAP,
  inferPlatformKey,
  getAvailableStock,
} from "@/pages/ProductsPage";

const BTN_NAVY = "#0f172a";
const TEXT_BLACK = "#000000";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const MIN_PAYSTACK_NAIRA = 100;
  const meetsMinimum = Number.isFinite(totalPrice) && totalPrice >= MIN_PAYSTACK_NAIRA;
  const canStartPayment =
    Boolean(currentUser?.email) && Number.isFinite(totalPrice) && totalPrice > 0 && meetsMinimum;
  const platform = PLATFORM_MAP[inferPlatformKey(product.title)];
  const canAttemptPurchase = availableStock > 0;

  const handlePurchase = async () => {
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
      if (totalPrice < MIN_PAYSTACK_NAIRA) {
        setPurchaseState({ phase: "error", message: "Minimum purchase amount is ₦100" });
        setPurchasing(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("pocketfi-init", {
        body: {
          amount: totalPrice,
          email: currentUser.email,
          product_id: product.id,
          quantity: qty,
        },
      });

      if (error) {
        let detailed = error.message || "Unable to start payment.";
        const ctx = (error as { context?: unknown }).context;
        if (ctx instanceof Response) {
          try {
            const text = await ctx.text();
            if (text) {
              try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                detailed =
                  (typeof parsed.error === "string" && parsed.error) ||
                  (typeof parsed.message === "string" && parsed.message) ||
                  text;
              } catch {
                detailed = text;
              }
            }
          } catch {
            /* keep default */
          }
        }
        setPurchaseState({ phase: "error", message: detailed });
        setPurchasing(false);
        return;
      }

      const payload = (data ?? {}) as Record<string, unknown>;
      const payUrl = extractPaystackRedirectUrl(payload);
      if (!payUrl) {
        const msg =
          (typeof payload.error === "string" && payload.error) ||
          (typeof payload.message === "string" && payload.message) ||
          "Unable to start payment right now.";
        setPurchaseState({ phase: "error", message: msg });
        setPurchasing(false);
        return;
      }

      const reference =
        typeof payload.reference === "string" && payload.reference.trim()
          ? payload.reference.trim()
          : typeof (payload.data as Record<string, unknown> | undefined)?.reference === "string"
            ? String((payload.data as Record<string, unknown>).reference).trim()
            : "";

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
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: currentUser.id,
        amount: naira,
        type: "purchase",
        status: "pending",
        reference,
        product_id: product.id,
        quantity: qty,
      });

      if (txError) {
        setPurchaseState({
          phase: "error",
          message: `Could not record purchase: ${txError.message}`,
        });
        setPurchasing(false);
        return;
      }

      window.location.replace(payUrl.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to start payment.";
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
                <h3 className="font-bold text-sm leading-tight pr-2 line-clamp-1" style={{ color: TEXT_BLACK }}>{product.title}</h3>
                <p className="text-[11px] mt-0.5" style={{ color: TEXT_BLACK }}>
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
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: TEXT_BLACK }}>Select Quantity</p>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  className="h-10 w-10 rounded-xl border border-slate-200 dark:border-white/12 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/8 transition-colors disabled:opacity-30"
                  style={{ color: TEXT_BLACK }}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <div className="flex-1 text-center">
                  <span className="font-bold text-3xl" style={{ color: TEXT_BLACK }}>{qty}</span>
                  <span className="text-sm ml-2" style={{ color: TEXT_BLACK }}>account{qty > 1 ? "s" : ""}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={qty >= maxQty}
                  className="h-10 w-10 rounded-xl border border-slate-200 dark:border-white/12 flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/8 transition-colors disabled:opacity-30"
                  style={{ color: TEXT_BLACK }}
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
                <p className="text-sm text-red-600 dark:text-red-400">{purchaseState.message}</p>
              </div>
            )}
            {purchaseState.phase === "processing" && (
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20">
                <Loader2 className="h-4 w-4 text-sky-500 mt-0.5 shrink-0 animate-spin" />
                <p className="text-sm text-sky-700 dark:text-sky-300">{purchaseState.message}</p>
              </div>
            )}

            {!canAfford && availableStock > 0 && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Need ₦{(totalPrice - balance).toLocaleString()} more.{" "}
                <Link to={`/dashboard/wallet?amount=${Math.max(100, totalPrice - balance)}`} onClick={onClose} className="underline underline-offset-2 font-semibold" style={{ color: TEXT_BLACK }}>
                  Fund with Paystack →
                </Link>
              </p>
            )}
            {!currentUser?.email && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Please log in to continue.
              </p>
            )}
            {availableStock > 0 && totalPrice > 0 && totalPrice < MIN_PAYSTACK_NAIRA && (
              <p className="text-xs text-center" style={{ color: TEXT_BLACK }}>
                Minimum purchase amount is ₦100
              </p>
            )}

            <button
              type="button"
              onClick={handlePurchase}
              disabled={!canAttemptPurchase || purchasing || !canAfford || !canStartPayment}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: BTN_NAVY,
                boxShadow: (!purchasing && canAfford) ? "0 4px 14px rgba(15,23,42,0.35)" : "none",
              }}
            >
              {purchasing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Redirecting to Payment...</>
              ) : (
                <><Eye className="h-4 w-4" /> Purchase {qty} account{qty > 1 ? "s" : ""} · ₦{totalPrice.toLocaleString()}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
