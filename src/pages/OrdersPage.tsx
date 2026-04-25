import { useState, useEffect, useRef } from "react";
import {
  ClipboardList,
  Eye,
  X,
  Copy,
  Check,
  ShieldCheck,
  Package,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { useApp, Order } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Category colour map (matches ProductsPage) ───────────────────────────────
const CATEGORY_STYLE: Record<string, string> = {
  "Social Media": "bg-blue-500/10 text-blue-400",
  Streaming: "bg-pink-500/10 text-pink-400",
  VPN: "bg-indigo-500/10 text-indigo-400",
};

function categoryStyle(cat: string) {
  return CATEGORY_STYLE[cat] ?? "bg-white/8 text-slate-400";
}

function parseDeliveredData(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseCredentialsDeliveredFlag(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (Array.isArray(raw)) return raw.length > 0;
  if (raw && typeof raw === "object") return true;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "t" || v === "1";
  }
  return false;
}

// ─── Credential Viewer Modal ───────────────────────────────────────────────────

type ModalOrder = Order & {
  credentials?: string;
  status?: string;
  credentialsDelivered?: boolean;
  productDescription?: string;
};

function CredentialModal({
  order,
  onClose,
  canRetryFulfillment,
  retryingFulfillment,
  recoveringDelivery,
  onRetryFulfillment,
  onRecoverDelivery,
}: {
  order: ModalOrder;
  onClose: () => void;
  canRetryFulfillment: boolean;
  retryingFulfillment: boolean;
  recoveringDelivery: boolean;
  onRetryFulfillment: (transactionId: string) => Promise<void>;
  onRecoverDelivery: (transactionId: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const credentials = parseDeliveredData(order.deliveredLog || order.credentials || "");
  const credentialLines = credentials.split(/\r?\n/).filter((line) => line.length > 0);
  const statusValue = String(order.status ?? "").toLowerCase();
  const isCompleted = statusValue === "completed" || statusValue === "finalized";
  const credentialsDelivered = Boolean(order.credentialsDelivered);
  const [copiedLine, setCopiedLine] = useState<string | null>(null);

  const handleCopy = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(credentials).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyLine = (line: string) => {
    navigator.clipboard.writeText(line).then(() => {
      setCopiedLine(line);
      setTimeout(() => setCopiedLine((prev) => (prev === line ? null : prev)), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.35)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden dark:border-slate-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-slate-900">Order Receipt</h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                #{order.id.slice(-10).toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Order metadata */}
        <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b border-slate-200">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Product</p>
            <p className="text-xs font-semibold text-slate-900 leading-snug line-clamp-2">
              {order.productTitle}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Amount</p>
            <p className="text-sm font-bold text-accent">₦{order.amount.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Date</p>
            <p className="text-xs font-semibold text-slate-900">
              {new Date(order.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
            Product Details
          </p>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {String(order.productDescription ?? "").trim() || "No extra instructions provided for this product."}
          </p>
        </div>

        {/* Credential block */}
        <div className="px-6 py-5">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-3">
            Account Credentials
          </p>

          {!isCompleted ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              Processing: your order is still being fulfilled. Please check back shortly.
            </div>
          ) : credentials ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                    Delivered data
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {order.category}
                </span>
              </div>

              <div className="px-4 py-3">
                <pre className="min-h-[180px] overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-sm leading-relaxed text-slate-900 whitespace-pre-wrap break-words">
                  {credentials}
                </pre>
              </div>
              <div className="px-4 pb-4 space-y-2">
                {credentialLines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2"
                  >
                    <p className="font-mono text-sm leading-relaxed flex-1 min-w-0 whitespace-pre-wrap break-words text-slate-900">
                      {line}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopyLine(line)}
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      {copiedLine === line ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            credentialsDelivered ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <Loader2 className="h-6 w-6 text-accent animate-spin" />
                <p className="text-sm text-slate-600">Fetching credentials...</p>
                {canRetryFulfillment && (
                  <button
                    type="button"
                    onClick={() => void onRetryFulfillment(order.id)}
                    disabled={retryingFulfillment}
                    className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition disabled:opacity-60"
                  >
                    {retryingFulfillment ? "Retrying..." : "Retry Fulfillment"}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center">
                <p className="text-sm text-slate-600">
                  Processing your accounts...
                </p>
                <button
                  type="button"
                  onClick={() => void onRecoverDelivery(order.id)}
                  disabled={recoveringDelivery}
                  className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition disabled:opacity-60"
                >
                  {recoveringDelivery ? "Refreshing..." : "Refresh Credentials"}
                </button>
                {canRetryFulfillment && (
                  <button
                    type="button"
                    onClick={() => void onRetryFulfillment(order.id)}
                    disabled={retryingFulfillment}
                    className="mt-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition disabled:opacity-60"
                  >
                    {retryingFulfillment ? "Retrying..." : "Retry Fulfillment"}
                  </button>
                )}
              </div>
            )
          )}

          {/* Copy button (always visible below the box) */}
          {credentials && isCompleted && (
            <button
              onClick={handleCopy}
              className={`mt-3 flex items-center gap-2 w-full justify-center py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 border ${
                copied
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied to clipboard!" : "Copy credentials"}
            </button>
          )}
        </div>

        {/* Warning footer */}
        <div className="px-6 pb-5">
          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            These credentials are sensitive. Do not share them. For assistance, visit{" "}
            <Link to="/dashboard/support" className="text-accent/60 underline underline-offset-2 hover:text-accent">
              Support
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Orders Page ──────────────────────────────────────────────────────────

type DbOrder = {
  id: string;
  amount: number;
  created_at: string;
  status: string | null;
  quantity: number | null;
  log_id: string | null;
  product_id: string | null;
  product_description?: string | null;
  products: { title: string; category: string; description?: string | null } | null;
  delivered_data?: unknown;
  credentials_delivered?: unknown;
  _credentials?: string | null;
};

export default function OrdersPage() {
  const { orders, currentUser } = useApp();
  const [viewing, setViewing] = useState<ModalOrder | null>(null);
  const [dbOrders, setDbOrders] = useState<DbOrder[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [recoveringOrderId, setRecoveringOrderId] = useState<string | null>(null);
  const [retryingMissingBulk, setRetryingMissingBulk] = useState(false);
  const attemptedAutoRecoverRef = useRef<Set<string>>(new Set());
  const isAdminUser = Boolean(currentUser?.is_admin || currentUser?.role === "admin");

  const retryFulfillment = async (transactionId: string) => {
    if (!transactionId || !supabase) return;
    if (!isAdminUser) return;
    setRetryingOrderId(transactionId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch("/api/admin/retry-fulfillment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transactionId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Retry fulfillment failed.");
      }

      setRefreshNonce((v) => v + 1);
      window.dispatchEvent(new CustomEvent("orders:refresh"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Retry fulfillment failed.";
      console.error("[OrdersPage] Retry fulfillment failed", message);
      window.alert(message);
    } finally {
      setRetryingOrderId(null);
    }
  };

  const retryMissingFulfillment = async () => {
    if (!supabase || !isAdminUser) return;
    setRetryingMissingBulk(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch("/api/admin/retry-missing-fulfillment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 50 }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        scanned?: number;
        retried_successfully?: number;
        failed?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Bulk retry failed.");
      }
      setRefreshNonce((v) => v + 1);
      window.dispatchEvent(new CustomEvent("orders:refresh"));
      window.alert(
        `Bulk retry complete.\nScanned: ${Number(payload.scanned ?? 0)}\nRecovered: ${Number(payload.retried_successfully ?? 0)}\nFailed: ${Number(payload.failed ?? 0)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bulk retry failed.";
      console.error("[OrdersPage] Bulk retry fulfillment failed", message);
      window.alert(message);
    } finally {
      setRetryingMissingBulk(false);
    }
  };

  const recoverDelivery = async (transactionId: string) => {
    if (!transactionId || !supabase) return;
    setRecoveringOrderId(transactionId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch("/api/orders/recover-delivery", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transactionId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not refresh credentials yet.");
      }
      setRefreshNonce((v) => v + 1);
      window.dispatchEvent(new CustomEvent("orders:refresh"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not refresh credentials yet.";
      console.error("[OrdersPage] Recover delivery failed", message);
      window.alert(message);
    } finally {
      setRecoveringOrderId(null);
    }
  };

  useEffect(() => {
    if (!viewing) return;
    const status = String(viewing.status ?? "").toLowerCase();
    const isFulfilled = status === "completed" || status === "success" || status === "finalized";
    const hasCredentials = Boolean(parseDeliveredData(viewing.deliveredLog).trim());
    if (!isFulfilled || hasCredentials) return;
    if (attemptedAutoRecoverRef.current.has(viewing.id)) return;
    attemptedAutoRecoverRef.current.add(viewing.id);
    void recoverDelivery(viewing.id);
  }, [viewing]);

  // User's local orders from AppContext (works offline + immediately after purchase)
  const localOrders = orders.filter((o) => o.userId === currentUser?.id);

  useEffect(() => {
    const onRefresh = () => setRefreshNonce((v) => v + 1);
    window.addEventListener("orders:refresh", onRefresh);
    return () => window.removeEventListener("orders:refresh", onRefresh);
  }, []);

  // Primary source of truth: transactions table (delivered_data + credentials_delivered).
  useEffect(() => {
    if (!supabase || !currentUser?.id || !UUID_REGEX.test(currentUser.id)) return;
    setLoadingDb(true);
    supabase
      .from("transactions")
      .select("id, amount, created_at, status, quantity, log_id, product_id, product_description, delivered_data, credentials_delivered, products(title, category, description)")
      .eq("user_id", currentUser.id)
      .in("type", ["purchase", "wallet_payment"])
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDbOrders(data as DbOrder[]);
        setLoadingDb(false);
      });
  }, [currentUser?.id, refreshNonce]);

  // Merge DB orders with local — DB rows take precedence (deduplicated by id).
  // Local rows are kept for immediately-purchased items not yet in the DB query.
  const mergedOrders: Array<Order & { log_id?: string }> = (() => {
    const seen = new Set<string>();
    const result: Array<Order & { log_id?: string }> = [];

    // DB-sourced rows first (most authoritative)
    for (const db of dbOrders) {
      seen.add(db.id);
      result.push({
        id: db.id,
        userId: currentUser?.id ?? "",
        userName: currentUser?.name ?? "",
        productId: db.product_id ?? "",
        productTitle: db.products?.title ?? "Unknown Product",
        category: db.products?.category ?? "",
        productDescription: String(db.product_description ?? db.products?.description ?? ""),
        amount: db.amount,
        deliveredLog: parseDeliveredData(db.delivered_data ?? db._credentials ?? ""),
        createdAt: db.created_at,
        log_id: db.log_id ?? undefined,
        status: db.status ?? undefined,
        credentialsDelivered: parseCredentialsDeliveredFlag(db.credentials_delivered),
      });
    }

    // Local rows that aren't already in DB result (e.g. just purchased this session)
    for (const lo of localOrders) {
      if (!seen.has(lo.id)) {
        result.push({ ...lo, status: "completed", credentialsDelivered: Boolean(lo.deliveredLog) });
      }
    }

    return result;
  })();

  const isEmpty = mergedOrders.length === 0 && !loadingDb;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 text-slate-900 shadow-sm space-y-6 dark:border-slate-200">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5 text-slate-900">
          <ClipboardList className="h-6 w-6 text-accent" />
          My Orders
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Your purchase history and delivered account credentials
        </p>
        {isAdminUser && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void retryMissingFulfillment()}
              disabled={retryingMissingBulk}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition disabled:opacity-60"
            >
              {retryingMissingBulk ? "Retrying missing credentials..." : "Retry Missing Credentials"}
            </button>
          </div>
        )}
      </div>

      {/* Table card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loadingDb && mergedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-slate-600">Loading your orders…</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center">
              <Package className="h-7 w-7 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-800">No orders yet</p>
              <p className="text-sm text-slate-600 mt-1">
                Your purchased accounts will appear here after checkout.
              </p>
            </div>
            <Link to="/dashboard/products">
              <Button variant="outline" className="gap-2 mt-1">
                Browse Products
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-slate-900">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-3.5 text-left font-semibold text-slate-600">Product</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-slate-600 hidden sm:table-cell">
                    Category
                  </th>
                  <th className="px-5 py-3.5 text-right font-semibold text-slate-600">Amount</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-slate-600 hidden md:table-cell">
                    Date
                  </th>
                  <th className="px-5 py-3.5 text-center font-semibold text-slate-600">
                    Credentials
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {mergedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                    {/* Product name */}
                    <td className="px-5 py-4 max-w-[220px]">
                      <p className="font-semibold text-sm leading-snug line-clamp-2 text-slate-900">
                        {order.productTitle}
                      </p>
                      {/* Show date on mobile */}
                      <p className="text-xs text-slate-500 mt-0.5 md:hidden">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </td>

                    {/* Category badge */}
                    <td className="px-5 py-4 text-center hidden sm:table-cell">
                      {order.category ? (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold ${categoryStyle(order.category)}`}
                        >
                          {order.category}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-4 text-right font-bold text-accent whitespace-nowrap">
                      ₦{order.amount.toLocaleString()}
                    </td>

                    {/* Date */}
                    <td className="px-5 py-4 text-center text-slate-600 text-xs hidden md:table-cell whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    {/* View Details */}
                    <td className="px-5 py-4 text-center">
                      <button
                        onClick={() => setViewing(order)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credential modal */}
      {viewing && (
        <CredentialModal
          order={viewing}
          onClose={() => setViewing(null)}
          canRetryFulfillment={isAdminUser && String(viewing.status ?? "").toLowerCase() === "completed" && !parseDeliveredData(viewing.deliveredLog).trim()}
          retryingFulfillment={retryingOrderId === viewing.id}
          recoveringDelivery={recoveringOrderId === viewing.id}
          onRetryFulfillment={retryFulfillment}
          onRecoverDelivery={recoverDelivery}
        />
      )}
    </div>
  );
}
