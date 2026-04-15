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

// ─── Credential Viewer Modal ───────────────────────────────────────────────────

function CredentialModal({
  order,
  onClose,
}: {
  order: Order & { credentials?: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState<string | null>(order.deliveredLog || order.credentials || null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  // If credentials not in local state but we have a log_id from Supabase,
  // fetch them now (RLS enforces the buyer-only policy server-side).
  useEffect(() => {
    if (credentials || !supabase) return;
    const logId = (order as { log_id?: string }).log_id;
    if (!logId || !UUID_REGEX.test(logId)) return;

    setFetching(true);
    supabase
      .from("log_items")
      .select("credentials")
      .eq("id", logId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          void supabase
            .from("logs_data")
            .select("credentials")
            .eq("id", logId)
            .single()
            .then(({ data: d2, error: e2 }) => {
              setFetching(false);
              if (e2 || !d2) {
                setFetchError("Could not retrieve credentials. Please contact support.");
                return;
              }
              setCredentials(String((d2 as { credentials?: string }).credentials ?? ""));
            });
          return;
        }
        if (!data) {
          setFetchError("Could not retrieve credentials. Please contact support.");
        } else {
          setCredentials(String((data as { credentials?: string }).credentials ?? ""));
        }
        setFetching(false);
      });
  }, [credentials, order]);

  const handleCopy = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(credentials).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-lg bg-[hsl(var(--sidebar-background))] border border-sidebar-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-accent" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-sidebar-foreground">Order Receipt</h2>
              <p className="text-xs text-sidebar-foreground/40 mt-0.5 font-mono">
                #{order.id.slice(-10).toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Order metadata */}
        <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b border-sidebar-border">
          <div className="bg-sidebar-accent/30 rounded-xl p-3">
            <p className="text-[10px] text-sidebar-foreground/40 uppercase tracking-wider mb-1">Product</p>
            <p className="text-xs font-semibold text-sidebar-foreground leading-snug line-clamp-2">
              {order.productTitle}
            </p>
          </div>
          <div className="bg-sidebar-accent/30 rounded-xl p-3">
            <p className="text-[10px] text-sidebar-foreground/40 uppercase tracking-wider mb-1">Amount</p>
            <p className="text-sm font-bold text-accent">₦{order.amount.toLocaleString()}</p>
          </div>
          <div className="bg-sidebar-accent/30 rounded-xl p-3">
            <p className="text-[10px] text-sidebar-foreground/40 uppercase tracking-wider mb-1">Date</p>
            <p className="text-xs font-semibold text-sidebar-foreground">
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
          <p className="text-xs text-sidebar-foreground/40 uppercase tracking-wider font-semibold mb-3">
            Account Credentials
          </p>

          {fetching ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-6 w-6 text-accent animate-spin" />
              <p className="text-xs text-sidebar-foreground/50">Retrieving credentials…</p>
            </div>
          ) : fetchError ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {fetchError}
            </div>
          ) : credentials ? (
            /* ── The "Secret Key" credential box ── */
            <div
              className="relative rounded-xl overflow-hidden cursor-pointer group"
              style={{
                background: "#060b14",
                border: "1px solid rgba(16,185,129,0.20)",
                boxShadow: "0 0 24px rgba(16,185,129,0.06)",
              }}
              onClick={handleCopy}
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
              <div className="px-4 py-4 select-all">
                <p
                  className="font-mono text-sm break-all leading-relaxed"
                  style={{ color: "rgba(52,211,153,0.88)" }}
                >
                  {credentials}
                </p>
              </div>

              {/* Hover overlay — copy affordance */}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "rgba(6,11,20,0.5)" }}
              >
                <div
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    background: "rgba(16,185,129,0.15)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    color: "rgba(52,211,153,1)",
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Click to Copy"}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/20 px-5 py-8 text-center">
              <p className="text-sm text-sidebar-foreground/40">No credentials on record.</p>
            </div>
          )}

          {/* Copy button (always visible below the box) */}
          {credentials && !fetching && (
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
          <p className="text-[11px] text-sidebar-foreground/30 text-center leading-relaxed">
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
  log_id: string | null;
  product_id: string | null;
  products: { title: string; category: string } | null;
  _credentials?: string | null;
};

export default function OrdersPage() {
  const { orders, currentUser } = useApp();
  const [viewing, setViewing] = useState<(Order & { credentials?: string }) | null>(null);
  const [dbOrders, setDbOrders] = useState<DbOrder[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // User's local orders from AppContext (works offline + immediately after purchase)
  const localOrders = orders.filter((o) => o.userId === currentUser?.id);

  useEffect(() => {
    const onRefresh = () => setRefreshNonce((v) => v + 1);
    window.addEventListener("orders:refresh", onRefresh);
    return () => window.removeEventListener("orders:refresh", onRefresh);
  }, []);

  // When Supabase is available, fetch from log_items (buyer_id) joined with products
  useEffect(() => {
    if (!supabase || !currentUser?.id || !UUID_REGEX.test(currentUser.id)) return;
    setLoadingDb(true);
    supabase
      .from("log_items")
      .select("id, created_at, product_id, credentials, products(title, category, price)")
      .eq("buyer_id", currentUser.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          // Fallback: try legacy transactions table if log_items doesn't exist yet
          supabase!
            .from("transactions")
            .select("id, amount, created_at, log_id, product_id, products(title, category)")
            .eq("user_id", currentUser.id)
            .eq("type", "purchase")
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .then(({ data: txData }) => {
              if (txData) setDbOrders(txData as DbOrder[]);
              setLoadingDb(false);
            });
          return;
        }
        if (data) {
          // Map log_items shape onto DbOrder shape
          const mapped: DbOrder[] = (data as {
            id: string;
            created_at: string;
            product_id: string | null;
            credentials: string | null;
            products: { title: string; category: string; price?: number } | null;
          }[]).map((row) => ({
            id: row.id,
            amount: row.products?.price ?? 0,
            created_at: row.created_at,
            log_id: row.id,           // log_items row IS the log — use its id
            product_id: row.product_id,
            products: row.products ? { title: row.products.title, category: row.products.category } : null,
            _credentials: row.credentials, // stash for immediate display
          }));
          setDbOrders(mapped as DbOrder[]);
        }
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
        deliveredLog: db._credentials ?? "",  // inline credentials from log_items
        createdAt: db.created_at,
        log_id: db.log_id ?? undefined,
      });
    }

    // Local rows that aren't already in DB result (e.g. just purchased this session)
    for (const lo of localOrders) {
      if (!seen.has(lo.id)) {
        result.push(lo);
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
        />
      )}
    </div>
  );
}
