import { useState, useEffect } from "react";
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
};

function CredentialModal({
  order,
  onClose,
  canRetryFulfillment,
  retryingFulfillment,
  onRetryFulfillment,
}: {
  order: ModalOrder;
  onClose: () => void;
  canRetryFulfillment: boolean;
  retryingFulfillment: boolean;
  onRetryFulfillment: (transactionId: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const credentials = parseDeliveredData(order.deliveredLog || order.credentials || "");
  const credentialLines = credentials
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-white/10 dark:bg-[#0b1120]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-slate-900 dark:text-white">Order Receipt</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                #{order.id.slice(-10).toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Order metadata */}
        <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b border-slate-200 dark:border-white/10">
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-white/5">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Product</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2">
              {order.productTitle}
            </p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-white/5">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Amount</p>
            <p className="text-sm font-bold text-accent">₦{order.amount.toLocaleString()}</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-white/5">
            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Date</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-white">
              {new Date(order.createdAt).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Credential block */}
        <div className="px-6 py-5">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold mb-3">
            Account Credentials
          </p>

          {!isCompleted ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-700 dark:text-amber-300">
              Processing: your order is still being fulfilled. Please check back shortly.
            </div>
          ) : credentials ? (
            /* ── The "Secret Key" credential box ── */
            <div
              className="relative rounded-xl overflow-hidden"
              style={{
                background: "#060b14",
                border: "1px solid rgba(16,185,129,0.20)",
                boxShadow: "0 0 24px rgba(16,185,129,0.06)",
              }}
            >
              {/* Top bar */}
              <div
                className="flex items-center justify-between px-4 py-2.5 border-b"
                style={{ borderColor: "rgba(16,185,129,0.12)", background: "rgba(16,185,129,0.05)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent/70 animate-pulse" />
                  <span
                    className="text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: "rgba(52,211,153,0.7)" }}
                  >
                    Classified · Account Data
                  </span>
                </div>
                <span
                  className="text-[10px] font-mono"
                  style={{ color: "rgba(52,211,153,0.35)" }}
                >
                  {order.category}
                </span>
              </div>

              {/* Credential text */}
              <div className="px-4 py-3">
                <textarea
                  readOnly
                  value={credentials}
                  className="w-full min-h-[180px] resize-y rounded-lg border border-emerald-500/30 bg-[#040a12] px-3 py-3 font-mono text-sm leading-relaxed text-emerald-300 focus:outline-none"
                />
              </div>
              <div className="px-4 pb-4 space-y-2">
                {credentialLines.map((line, index) => (
                  <div
                    key={`${line}-${index}`}
                    className="flex items-start justify-between gap-2 rounded-md border px-2 py-2"
                    style={{ borderColor: "rgba(16,185,129,0.12)", background: "rgba(16,185,129,0.03)" }}
                  >
                    <p
                      className="font-mono text-sm break-all leading-relaxed flex-1 min-w-0"
                      style={{ color: "rgba(52,211,153,0.88)" }}
                    >
                      {line}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCopyLine(line)}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold"
                      style={{
                        background: "rgba(16,185,129,0.15)",
                        border: "1px solid rgba(16,185,129,0.3)",
                        color: "rgba(52,211,153,1)",
                      }}
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
                <p className="text-sm text-slate-600 dark:text-slate-300">Fetching credentials...</p>
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
              <div className="rounded-xl border border-slate-200 bg-slate-100 px-5 py-8 text-center dark:border-white/10 dark:bg-white/5">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Processing your accounts...
                </p>
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
              className="mt-3 flex items-center gap-2 w-full justify-center py-2.5 rounded-xl text-sm font-semibold transition-all duration-150"
              style={{
                background: copied ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
                color: copied ? "rgba(52,211,153,1)" : "rgba(220,220,230,0.6)",
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied to clipboard!" : "Copy credentials"}
            </button>
          )}
        </div>

        {/* Warning footer */}
        <div className="px-6 pb-5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
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
  products: { title: string; category: string } | null;
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
      .select("id, amount, created_at, status, quantity, log_id, product_id, delivered_data, credentials_delivered, products(title, category)")
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5">
          <ClipboardList className="h-6 w-6 text-accent" />
          My Orders
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your purchase history and delivered account credentials
        </p>
      </div>

      {/* Table card */}
      <div className="glass-card overflow-hidden">
        {loadingDb && mergedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading your orders…</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white/6 flex items-center justify-center">
              <Package className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground/60">No orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/3">
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">Product</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden sm:table-cell">
                    Category
                  </th>
                  <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Amount</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden md:table-cell">
                    Date
                  </th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">
                    Credentials
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mergedOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">
                    {/* Product name */}
                    <td className="px-5 py-4 max-w-[220px]">
                      <p className="font-medium text-sm leading-snug line-clamp-2">
                        {order.productTitle}
                      </p>
                      {/* Show date on mobile */}
                      <p className="text-xs text-muted-foreground mt-0.5 md:hidden">
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
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-4 text-right font-bold text-accent whitespace-nowrap">
                      ₦{order.amount.toLocaleString()}
                    </td>

                    {/* Date */}
                    <td className="px-5 py-4 text-center text-muted-foreground text-xs hidden md:table-cell whitespace-nowrap">
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
          onRetryFulfillment={retryFulfillment}
        />
      )}
    </div>
  );
}
