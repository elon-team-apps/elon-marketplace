import { useState, useEffect, useCallback, useMemo } from "react";
import {
  TrendingUp, Users, Package, ShoppingCart, ArrowUpRight,
  Crown, Loader2, RefreshCw, Plus, Minus, Search, Wallet, Flame,
  BarChart2, ChevronDown, Calendar
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { calculateStock } from "@/lib/stock";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ProductBrandAvatar } from "@/components/ProductBrandAvatar";

// ── Types ──────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  email: string;
  wallet_balance: number;
  role: string;
  is_admin?: boolean;
  created_at: string;
};

function profileIsAdmin(p: Pick<Profile, "role" | "is_admin">): boolean {
  return p.is_admin === true || (p.role ?? "").toLowerCase() === "admin";
}

type PaymentMethodSettingsRow = {
  pocketfi_enabled: boolean;
  flutterwave_enabled: boolean;
  manual_enabled: boolean;
};

type PaymentMethodSettings = {
  flutterwaveEnabled: boolean;
  pocketfiEnabled: boolean;
  manualEnabled: boolean;
};

function mapPaymentSettings(row: PaymentMethodSettingsRow | null | undefined): PaymentMethodSettings {
  return {
    flutterwaveEnabled: Boolean(row?.flutterwave_enabled ?? true),
    pocketfiEnabled: Boolean(row?.pocketfi_enabled),
    manualEnabled: Boolean(row?.manual_enabled),
  };
}

function toPaymentSettingsUpdate(settings: PaymentMethodSettings): PaymentMethodSettingsRow {
  return {
    pocketfi_enabled: settings.pocketfiEnabled,
    flutterwave_enabled: settings.flutterwaveEnabled,
    manual_enabled: settings.manualEnabled,
  };
}

type DailyOrderCount = {
  dayKey: string;
  count: number;
};

// ── MonthlyRevenueChart ────────────────────────────────────────────────────

type MonthlyRevenueRow = {
  month_num: number;
  month_name: string;
  revenue: number;
  orders: number;
};

const MONTH_FULL: Record<string, string> = {
  Jan: "January", Feb: "February", Mar: "March",
  Apr: "April",   May: "May",      Jun: "June",
  Jul: "July",    Aug: "August",   Sep: "September",
  Oct: "October", Nov: "November", Dec: "December",
};

function MonthlyRevenueChart() {
  const currentYear = new Date().getFullYear();
  const [fromYear, setFromYear] = useState(currentYear);
  const [toYear, setToYear] = useState(currentYear);
  const [data, setData] = useState<MonthlyRevenueRow[]>([]);
  const [multiYearData, setMultiYearData] = useState<{ year: number; rows: MonthlyRevenueRow[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Build year options: 2020 up to current year
  const yearOptions = Array.from({ length: currentYear - 2019 }, (_, i) => 2020 + i).reverse();

  const isRange = toYear !== fromYear;

  const fetchData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      if (!isRange) {
        // Single year
        const { data: rows, error: err } = await supabase.rpc("get_monthly_revenue", { p_year: fromYear });
        if (err) throw new Error(err.message);
        setData((rows as MonthlyRevenueRow[]) ?? []);
        setMultiYearData([]);
      } else {
        // Multi-year range
        const start = Math.min(fromYear, toYear);
        const end = Math.max(fromYear, toYear);
        const years = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        const results = await Promise.all(
          years.map(async (yr) => {
            const { data: rows, error: err } = await supabase!.rpc("get_monthly_revenue", { p_year: yr });
            if (err) throw new Error(err.message);
            return { year: yr, rows: (rows as MonthlyRevenueRow[]) ?? [] };
          })
        );
        // Flatten to single series: aggregate all years into one month list
        const flat: MonthlyRevenueRow[] = Array.from({ length: 12 }, (_, i) => ({
          month_num: i + 1,
          month_name: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
          revenue: results.reduce((sum, yr) => sum + (yr.rows[i]?.revenue ?? 0), 0),
          orders:  results.reduce((sum, yr) => sum + (yr.rows[i]?.orders ?? 0), 0),
        }));
        setData(flat);
        setMultiYearData(results);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load monthly revenue.";
      setError(msg);
      toast({ title: "Revenue fetch failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fromYear, toYear, isRange, toast]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // Summary stats
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalOrders  = data.reduce((s, r) => s + r.orders, 0);
  const bestMonth    = data.reduce<MonthlyRevenueRow | null>((best, r) => (!best || r.revenue > best.revenue ? r : best), null);
  const avgMonthly   = data.length > 0 ? totalRevenue / data.filter(r => r.revenue > 0).length || 0 : 0;

  // Custom step-line tooltip
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; payload: MonthlyRevenueRow }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    return (
      <div
        className="rounded-xl border border-emerald-500/30 px-4 py-3 text-sm shadow-2xl"
        style={{ background: "rgba(5,15,20,0.95)", backdropFilter: "blur(12px)", minWidth: 160 }}
      >
        <p className="font-bold text-white mb-1.5">{MONTH_FULL[label ?? ""] ?? label}</p>
        <p className="text-emerald-400 font-bold text-base">₦{row.revenue.toLocaleString()}</p>
        <p className="text-slate-400 text-xs mt-1">{row.orders} orders</p>
      </div>
    );
  };

  const formatY = (v: number) =>
    v === 0 ? "₦0" : v >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `₦${(v / 1_000).toFixed(0)}k` : `₦${v}`;

  const maxRevenue = Math.max(...data.map(r => r.revenue), 1);

  return (
    <div className="glass-card p-5 space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <BarChart2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="font-heading font-bold text-sm text-foreground flex items-center gap-2">
              Monthly Revenue
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" /></span>
                LIVE
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Purchase revenue breakdown by month</p>
          </div>
        </div>

        {/* Year range selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">From</span>
          </div>
          <div className="relative">
            <select
              value={fromYear}
              onChange={e => setFromYear(Number(e.target.value))}
              className="h-8 pl-3 pr-7 rounded-lg border border-slate-200 dark:border-white/10 bg-background text-xs text-foreground font-semibold appearance-none cursor-pointer hover:border-emerald-500/40 transition-colors"
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">To</span>
          <div className="relative">
            <select
              value={toYear}
              onChange={e => setToYear(Number(e.target.value))}
              className="h-8 pl-3 pr-7 rounded-lg border border-slate-200 dark:border-white/10 bg-background text-xs text-foreground font-semibold appearance-none cursor-pointer hover:border-emerald-500/40 transition-colors"
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
          <Button
            variant="outline" size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void fetchData()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: isRange ? `Total Revenue (${Math.min(fromYear,toYear)}–${Math.max(fromYear,toYear)})` : `Total Revenue ${fromYear}`,
            value: `₦${totalRevenue.toLocaleString()}`,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10 border-emerald-500/20",
          },
          {
            label: "Total Orders",
            value: totalOrders.toLocaleString(),
            color: "text-sky-400",
            bg: "bg-sky-500/10 border-sky-500/20",
          },
          {
            label: "Best Month",
            value: bestMonth && bestMonth.revenue > 0
              ? `${MONTH_FULL[bestMonth.month_name] ?? bestMonth.month_name}`
              : "—",
            sub: bestMonth && bestMonth.revenue > 0 ? `₦${bestMonth.revenue.toLocaleString()}` : "",
            color: "text-amber-400",
            bg: "bg-amber-500/10 border-amber-500/20",
          },
          {
            label: "Avg / Active Month",
            value: `₦${Math.round(avgMonthly).toLocaleString()}`,
            color: "text-purple-400",
            bg: "bg-purple-500/10 border-purple-500/20",
          },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-3.5 ${card.bg}`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold leading-tight">{card.label}</p>
            <p className={`font-bold text-lg mt-1.5 leading-none ${card.color}`}>{card.value}</p>
            {'sub' in card && card.sub && <p className="text-[11px] text-muted-foreground mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* Chart */}
      <div
        className="relative rounded-2xl border border-white/8 overflow-hidden"
        style={{ background: "linear-gradient(180deg, rgba(5,18,25,0.9) 0%, rgba(2,10,15,0.98) 100%)" }}
      >
        {/* Subtle grid glow */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(16,185,129,0.07) 0%, transparent 70%)" }} />

        {loading ? (
          <div className="h-72 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
            Loading revenue data…
          </div>
        ) : error ? (
          <div className="h-72 flex items-center justify-center text-sm text-red-400">{error}</div>
        ) : (
          <div className="px-2 py-4">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="60%" stopColor="#10b981" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  stroke="rgba(255,255,255,0.05)"
                  vertical={false}
                />
                <XAxis
                  dataKey="month_name"
                  tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
                  axisLine={false}
                  tickLine={false}
                  dy={8}
                />
                <YAxis
                  tickFormatter={formatY}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  domain={[0, maxRevenue * 1.15]}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: "rgba(16,185,129,0.25)", strokeWidth: 1, strokeDasharray: "4 4" }}
                />
                {bestMonth && bestMonth.revenue > 0 && (
                  <ReferenceLine
                    x={bestMonth.month_name}
                    stroke="rgba(16,185,129,0.3)"
                    strokeDasharray="4 4"
                    label={{ value: "Best", position: "top", fill: "#10b981", fontSize: 10, fontWeight: 700 }}
                  />
                )}
                <Area
                  type="stepAfter"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#revGradient)"
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: "#10b981",
                    stroke: "#fff",
                    strokeWidth: 2,
                    style: { filter: "drop-shadow(0 0 6px rgba(16,185,129,0.8))" },
                  }}
                  isAnimationActive={true}
                  animationDuration={700}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Monthly breakdown table */}
      {!loading && !error && data.length > 0 && (
        <div className="rounded-xl border border-white/7 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/7 flex items-center gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monthly Breakdown</p>
            {isRange && (
              <span className="text-[10px] text-muted-foreground">
                (Aggregated {Math.min(fromYear,toYear)}–{Math.max(fromYear,toYear)})
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 divide-x divide-y divide-white/6">
            {data.map((row) => {
              const pct = maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0;
              const isBest = bestMonth?.month_num === row.month_num && bestMonth.revenue > 0;
              return (
                <div
                  key={row.month_num}
                  className={`px-4 py-3 relative group transition-colors ${
                    isBest ? "bg-emerald-500/8" : "hover:bg-white/3"
                  }`}
                >
                  {isBest && (
                    <span className="absolute top-2 right-2 text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Best</span>
                  )}
                  <p className="text-xs font-bold text-muted-foreground mb-1">
                    {MONTH_FULL[row.month_name] ?? row.month_name}
                  </p>
                  <p className={`font-bold text-base leading-none ${
                    row.revenue > 0 ? "text-foreground" : "text-muted-foreground/40"
                  }`}>
                    ₦{row.revenue.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">{row.orders} orders</p>
                  {/* Mini progress bar */}
                  <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: isBest
                          ? "linear-gradient(90deg, #10b981, #34d399)"
                          : "rgba(16,185,129,0.45)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


type WebhookVerificationRow = {
  id: string;
  provider: string;
  tx_ref: string;
  decision: "accepted" | "rejected" | string;
  reason: string | null;
  expected_amount: number | null;
  verified_amount: number | null;
  created_at: string;
};

function WebhookVerificationsCard() {
  const [txRef, setTxRef] = useState("");
  const [rows, setRows] = useState<WebhookVerificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<"all" | "accepted" | "rejected">("all");
  const { toast } = useToast();

  const fetchRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const params = new URLSearchParams();
      if (txRef.trim()) params.set("tx_ref", txRef.trim());
      if (decisionFilter !== "all") params.set("decision", decisionFilter);
      params.set("limit", "25");

      const response = await fetch(`/api/admin/webhook-verifications?${params.toString()}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        records?: WebhookVerificationRow[];
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load webhook verifications.");
      }

      setRows(Array.isArray(payload.records) ? payload.records : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load webhook verifications.";
      toast({ title: "Webhook audit fetch failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, toast, txRef]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-heading font-semibold text-sm text-foreground">Flutterwave Verification Audit</h2>
          <p className="text-xs text-muted-foreground mt-1">Search by tx_ref and inspect accepted/rejected webhook decisions.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void fetchRows()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        <Input
          placeholder="tx_ref (exact)"
          value={txRef}
          onChange={(e) => setTxRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void fetchRows();
          }}
          className="h-9 text-xs"
        />
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value as "all" | "accepted" | "rejected")}
          className="h-9 rounded-md border border-input bg-background px-3 text-xs text-foreground"
        >
          <option value="all">All decisions</option>
          <option value="accepted">Accepted only</option>
          <option value="rejected">Rejected only</option>
        </select>
        <Button
          className="h-9 text-xs"
          onClick={() => void fetchRows()}
          disabled={loading}
        >
          Run Search
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-white/7 bg-white/60 dark:bg-[rgba(8,11,20,0.5)] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading verification records...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No matching verification records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/6">
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Time</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">tx_ref</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Decision</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Expected</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Verified</th>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono">{row.tx_ref}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-md px-2 py-0.5 font-semibold ${
                        row.decision === "accepted"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-red-500/15 text-red-500"
                      }`}
                      >
                        {row.decision}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.expected_amount ?? "—"}</td>
                    <td className="px-3 py-2">{row.verified_amount ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[380px] truncate" title={row.reason ?? ""}>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UsersTable ─────────────────────────────────────────────────────────────

function UsersTable() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);  // true = syncing on mount
  const [search, setSearch] = useState("");
  const [adjusting, setAdjusting] = useState<{ userId: string; type: "add" | "deduct" } | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchProfiles = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, wallet_balance, role, is_admin, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load users", description: error.message, variant: "destructive" });
    } else if (data) {
      setProfiles(data as Profile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchProfiles();

    if (!supabase) return;
    const channel = supabase
      .channel("admin-dashboard-users-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void fetchProfiles();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = profiles.filter((p) =>
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleConfirm = async () => {
    if (!adjusting) return;
    const parsed = parseInt(amount, 10);
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
      return;
    }
    setSaving(true);

    if (supabase) {
      const target = profiles.find((p) => p.id === adjusting.userId);
      if (!target) { setSaving(false); return; }

      const newBalance =
        adjusting.type === "add"
          ? target.wallet_balance + parsed
          : target.wallet_balance - parsed;

      if (newBalance < 0) {
        toast({ title: "Cannot go below zero", description: "Deduct amount exceeds balance.", variant: "destructive" });
        setSaving(false);
        return;
      }

      const adjustAmount = adjusting.type === "add" ? parsed : -parsed;

      const { data: updatedBalance, error } = await supabase.rpc("increment_wallet_balance", {
        p_user_id: adjusting.userId,
        p_amount: adjustAmount,
      });

      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      setProfiles((prev) =>
        prev.map((p) => (p.id === adjusting.userId ? { ...p, wallet_balance: Number(updatedBalance) } : p))
      );
      toast({
        title: adjusting.type === "add" ? "Funds added" : "Funds deducted",
        description: `₦${parsed.toLocaleString()} ${adjusting.type === "add" ? "credited to" : "debited from"} ${target.email}.`,
      });
    }

    setSaving(false);
    setAdjusting(null);
    setAmount("");
  };

  return (
    <div className="space-y-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">
            Registered Users
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {profiles.length} total
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-44 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={fetchProfiles}
            disabled={loading}
          >
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 dark:border-white/7 bg-white/60 dark:bg-[rgba(8,11,20,0.5)] overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm font-medium text-foreground">Syncing Database…</p>
            <p className="text-xs text-muted-foreground">Fetching registered users from Supabase</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/6">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Email</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Balance</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">Joined</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Edit Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((profile) => (
                  <tr key={profile.id} className="hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">
                    {/* Name + avatar */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                          {(profile.email || "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 leading-tight text-xs">
                            {profile.email}
                            {profileIsAdmin(profile) && (
                              <Crown className="h-3 w-3 text-amber-500 dark:text-amber-400 shrink-0" />
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3.5 hidden md:table-cell max-w-[180px]">
                      <span className="truncate block text-xs text-muted-foreground">{profile.email}</span>
                    </td>

                    {/* Role badge */}
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          profileIsAdmin(profile)
                            ? "bg-amber-500/15 border border-amber-500/25 text-amber-600 dark:text-amber-400"
                            : "bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/8 text-slate-500"
                        }`}
                      >
                        {profileIsAdmin(profile) ? "admin" : (profile.role || "user")}
                      </span>
                    </td>

                    {/* Balance */}
                    <td className="px-4 py-3.5 text-right font-bold text-accent text-xs whitespace-nowrap">
                      ₦{(profile.wallet_balance ?? 0).toLocaleString()}
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3.5 text-center text-[11px] text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                      {profile.created_at
                        ? new Date(profile.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })
                        : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {adjusting?.userId === profile.id ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              placeholder="₦ Amount"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              className="h-7 w-24 text-xs"
                              min={1}
                              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={handleConfirm}
                              disabled={saving}
                              className="h-7 text-xs bg-accent hover:bg-accent/90 text-white px-2"
                            >
                              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "OK"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setAdjusting(null); setAmount(""); }}
                              className="h-7 text-xs text-slate-500 hover:text-slate-300 px-2"
                            >
                              ✕
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setAdjusting({ userId: profile.id, type: "add" }); setAmount(""); }}
                              className="h-7 text-xs gap-1 border-accent/30 text-accent hover:bg-accent/10 px-2"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setAdjusting({ userId: profile.id, type: "deduct" }); setAmount(""); }}
                              className="h-7 text-xs gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10 px-2"
                            >
                              <Minus className="h-3 w-3" /> Deduct
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && !loading && (
              <div className="py-10 text-center text-xs text-slate-600">
                {profiles.length === 0
                  ? "No profiles found in the database."
                  : "No users match your search."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AdminDashboard ─────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { products, orders } = useApp();
  const { isAdmin, profileLoaded } = useAuth();
  const { toast } = useToast();
  const [pmSettings, setPmSettings] = useState<PaymentMethodSettings>({
    flutterwaveEnabled: true,
    pocketfiEnabled: true,
    manualEnabled: false,
  });
  const [pmLoading, setPmLoading] = useState(false);
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [announcementActive, setAnnouncementActive] = useState(false);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [reconcilingDeposits, setReconcilingDeposits] = useState(false);
  const [dbTotalUsers, setDbTotalUsers] = useState<number | null>(null);
  const [dbPurchaseRevenue, setDbPurchaseRevenue] = useState<number | null>(null);
  const [dbLogsSold, setDbLogsSold] = useState<number | null>(null);
  const [dailyOrderCounts, setDailyOrderCounts] = useState<DailyOrderCount[]>([]);
  const [bestSellingIds, setBestSellingIds] = useState<{ product_id: string; sales_count: number }[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [newUsersToday, setNewUsersToday] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [todayOrderFlash, setTodayOrderFlash] = useState(false);

  const fetchAnalytics = useCallback(async (opts?: { silent?: boolean }) => {
    if (!supabase || !profileLoaded || !isAdmin) {
      setAnalyticsLoading(false);
      return;
    }
    if (!opts?.silent) setAnalyticsLoading(true);

    const [analyticsRes, dailyOrdersRes, bestSellingRes] = await Promise.all([
      // Accurate server-side RPC: revenue (purchases only) + logs_sold (delivered log_items)
      supabase.rpc("get_admin_analytics"),
      supabase
        .from("transactions")
        .select("created_at, type")
        .eq("status", "completed"),
      supabase.rpc("get_best_selling_products", { limit_val: 5 }),
    ]);

    // ── Analytics from RPC ──────────────────────────────────────────
    if (!analyticsRes.error && analyticsRes.data) {
      const d = analyticsRes.data as {
        revenue: number;
        logs_sold: number;
        total_users: number;
        new_today: number;
      };
      setDbPurchaseRevenue(Number(d.revenue ?? 0));
      setDbLogsSold(Number(d.logs_sold ?? 0));
      setDbTotalUsers(Number(d.total_users ?? 0));
      setNewUsersToday(Number(d.new_today ?? 0));
    }

    if (!bestSellingRes.error && bestSellingRes.data) {
      setBestSellingIds(bestSellingRes.data);
    }

    if (!dailyOrdersRes.error && dailyOrdersRes.data) {
      const rows = dailyOrdersRes.data as { created_at: string; type: string | null }[];
      const isPurchaseType = (value: string | null): boolean => {
        const txType = String(value ?? "").trim().toLowerCase();
        if (!txType) return true;
        return !["deposit", "wallet_topup", "topup"].includes(txType);
      };
      const byDay = rows
        .filter((r) => r.created_at && isPurchaseType(r.type))
        .reduce<Record<string, number>>((acc, row) => {
          const createdAt = new Date(row.created_at);
          if (Number.isNaN(createdAt.getTime())) return acc;
          const dayKey = createdAt.toISOString().slice(0, 10);
          acc[dayKey] = (acc[dayKey] ?? 0) + 1;
          return acc;
        }, {});
      const list = Object.entries(byDay)
        .map(([dayKey, count]) => ({ dayKey, count }))
        .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
        .slice(0, 7);
      setDailyOrderCounts(list);
    }

    setAnalyticsLoading(false);
    setLastUpdated(new Date());
  }, [isAdmin, profileLoaded]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    if (!supabase || !profileLoaded || !isAdmin) return;
    const channel = supabase
      .channel("admin-dashboard-analytics")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void fetchAnalytics({ silent: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
        void fetchAnalytics({ silent: true });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchAnalytics, isAdmin, profileLoaded]);

  // ── Dedicated lightweight real-time subscription for today's order count ──
  useEffect(() => {
    if (!supabase || !profileLoaded || !isAdmin) return;

    const fetchTodayCount = async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("transactions")
        .select("created_at, type")
        .eq("status", "completed")
        .gte("created_at", todayStart.toISOString());

      if (error || !data) return;

      const isPurchase = (v: string | null) => {
        const t = String(v ?? "").trim().toLowerCase();
        if (!t) return true;
        return !["deposit", "wallet_topup", "topup"].includes(t);
      };

      const count = (data as { created_at: string; type: string | null }[]).filter(
        (r) => isPurchase(r.type)
      ).length;

      setDailyOrderCounts((prev) => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const existing = prev.find((d) => d.dayKey === todayKey);
        const prevCount = existing?.count ?? 0;

        if (count > prevCount) {
          // Flash effect when new order arrives
          setTodayOrderFlash(true);
          setTimeout(() => setTodayOrderFlash(false), 2000);
        }

        if (!existing) {
          return [{ dayKey: todayKey, count }, ...prev].slice(0, 7);
        }
        return prev.map((d) => d.dayKey === todayKey ? { ...d, count } : d);
      });

      setLastUpdated(new Date());
    };

    // Initial fetch
    void fetchTodayCount();

    // Subscribe to real-time INSERT/UPDATE on transactions for instant count update
    const channel = supabase
      .channel("admin-today-orders-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transactions" },
        () => { void fetchTodayCount(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transactions" },
        () => { void fetchTodayCount(); }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, profileLoaded]);

  const resolveTotalStock = (p: (typeof products)[number]) => calculateStock(p);

  const activeStock = products.reduce((sum, p) => sum + resolveTotalStock(p), 0);

  const totalRevenue = dbPurchaseRevenue ?? 0;
  const totalLogsSold = dbLogsSold ?? 0;
  const totalUsers = dbTotalUsers ?? 0;
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);
  const todayOrderCount = dailyOrderCounts.find((d) => d.dayKey === todayKey)?.count ?? 0;
  const yesterdayOrderCount = dailyOrderCounts.find((d) => d.dayKey === yesterdayKey)?.count ?? 0;

  const stats = useMemo(
    () => [
      {
        label: "Total Revenue",
        value: analyticsLoading && dbPurchaseRevenue === null ? "—" : `₦${totalRevenue.toLocaleString()}`,
        icon: TrendingUp,
        color: "text-accent",
        bg: "bg-accent/10",
        change: `${analyticsLoading && dbLogsSold === null ? "—" : totalLogsSold} units sold (completed transactions)`,
      },
      {
        label: "Logs Sold",
        value: analyticsLoading && dbLogsSold === null ? "—" : totalLogsSold.toString(),
        icon: ShoppingCart,
        color: "text-sky-400",
        bg: "bg-sky-400/10",
        change: "sum of quantities on completed transactions",
      },
      {
        label: "Registered Users",
        value: analyticsLoading && dbTotalUsers === null ? "—" : totalUsers.toString(),
        icon: Users,
        color: "text-amber-400",
        bg: "bg-amber-400/10",
        change: "profiles table (live)",
        newToday: newUsersToday,
      },
      {
        label: "Active Stock",
        value: activeStock.toString(),
        icon: Package,
        color: "text-purple-400",
        bg: "bg-purple-400/10",
        change: `across ${products.length} products`,
      },
    ],
    [
      totalRevenue,
      totalLogsSold,
      totalUsers,
      activeStock,
      products.length,
      analyticsLoading,
      dbPurchaseRevenue,
      dbLogsSold,
      dbTotalUsers,
      newUsersToday,
    ],
  );

  const fetchSettings = useCallback(async () => {
    if (!supabase || !profileLoaded || !isAdmin) return;
    const { data: pmData, error: pmError } = await supabase
      .from("payment_method_settings")
      .select("pocketfi_enabled, flutterwave_enabled, manual_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (!pmError && pmData) setPmSettings(mapPaymentSettings(pmData as PaymentMethodSettingsRow));

    const { data: siteData, error: siteError } = await supabase
      .from("site_settings")
      .select("announcement_message, announcement_active")
      .eq("id", 1)
      .maybeSingle();
    if (!siteError && siteData) {
      setAnnouncementMsg(siteData.announcement_message ?? "");
      setAnnouncementActive(siteData.announcement_active ?? false);
    }
  }, [isAdmin, profileLoaded]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveAnnouncement = async () => {
    if (!supabase || !profileLoaded || !isAdmin) return;
    setSavingAnnouncement(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert({ id: 1, announcement_message: announcementMsg, announcement_active: announcementActive });
    
    if (error) {
      toast({ title: "Failed to save announcement", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Announcement saved", description: "The announcement has been updated." });
    }
    setSavingAnnouncement(false);
  };

  const togglePaymentMethod = async (field: "flutterwaveEnabled" | "pocketfiEnabled" | "manualEnabled") => {
    if (!supabase || !profileLoaded || !isAdmin) return;
    setPmLoading(true);
    const next = { ...pmSettings, [field]: !pmSettings[field] };
    const { error } = await supabase
      .from("payment_method_settings")
      .update(toPaymentSettingsUpdate(next))
      .eq("id", 1);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      setPmLoading(false);
      return;
    }
    setPmSettings(next);
    setPmLoading(false);
  };

  const reconcilePendingDeposits = async () => {
    if (!supabase || !profileLoaded || !isAdmin || reconcilingDeposits) return;
    setReconcilingDeposits(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");
      const response = await fetch("/api/admin/reconcile-pending-deposits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        checked?: number;
        completed?: number;
        skipped?: number;
        failed?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not reconcile pending deposits.");
      }
      toast({
        title: "Pending deposits reconciled",
        description: `Checked ${payload.checked ?? 0}. Completed ${payload.completed ?? 0}, skipped ${payload.skipped ?? 0}, failed ${payload.failed ?? 0}.`,
      });
      await fetchAnalytics();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reconcile pending deposits.";
      toast({ title: "Reconciliation failed", description: message, variant: "destructive" });
    } finally {
      setReconcilingDeposits(false);
    }
  };

  if (!profileLoaded) {
    return (
      <div className="glass-card p-6 text-sm text-muted-foreground">
        Loading admin profile...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="glass-card p-6 text-sm text-muted-foreground">
        Admin role required to view this dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Business overview for Elon Marketplace</p>
      </div>

      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5 hover:border-white/12 transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className={`h-10 w-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <ArrowUpRight className="h-4 w-4 text-slate-600" />
            </div>
            <div className="flex items-baseline gap-2 mb-0.5">
              <p className="font-heading text-2xl font-bold text-foreground">{s.value}</p>
              {'newToday' in s && s.newToday !== null && s.newToday !== undefined && s.newToday > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-500"
                  title={`+${s.newToday} new users registered today`}
                >
                  <span className="text-[13px] leading-none">+</span>
                  <span>{s.newToday}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{s.change}</p>
          </div>
        ))}
      </div>

      {/* ── Monthly Revenue Analytics ───────────────────────────────────────── */}
      <MonthlyRevenueChart />

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <h2 className="font-heading font-semibold text-sm text-foreground">Daily Orders</h2>
            {/* LIVE badge */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/25">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              LIVE
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void fetchAnalytics()}
              disabled={analyticsLoading}
            >
              {analyticsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Today box — flashes green on new order */}
          <div
            className={`rounded-xl border p-4 transition-all duration-700 ${
              todayOrderFlash
                ? "border-emerald-400/60 bg-emerald-500/10 dark:bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
                : "border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Today</p>
              {todayOrderFlash && (
                <span className="text-[10px] font-bold text-emerald-500 animate-pulse">+1 New!</span>
              )}
            </div>
            <p className={`text-3xl font-bold mt-1 transition-colors duration-500 ${
              todayOrderFlash ? "text-emerald-500" : "text-foreground"
            }`}>{todayOrderCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">orders</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 bg-slate-50 dark:bg-slate-800/50">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Yesterday</p>
            <p className="text-3xl font-bold text-foreground mt-1">{yesterdayOrderCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">orders</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/8 overflow-hidden">
          {dailyOrderCounts.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No completed purchase orders yet.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/6">
              {dailyOrderCounts.map((entry) => {
                const dayDate = new Date(`${entry.dayKey}T00:00:00Z`);
                const label = Number.isNaN(dayDate.getTime())
                  ? entry.dayKey
                  : dayDate.toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  });
                return (
                  <div key={entry.dayKey} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-bold text-foreground">{entry.count} orders</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <h2 className="font-heading font-semibold text-sm text-foreground">Top Selling Logs</h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void fetchAnalytics()}
            disabled={analyticsLoading}
          >
            {analyticsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/8 overflow-hidden">
          {bestSellingIds.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No sales data available yet.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/6">
              {bestSellingIds.map((item) => {
                const product = products.find(p => p.id === item.product_id);
                if (!product) return null;
                return (
                  <div key={item.product_id} className="px-4 py-3 flex items-center justify-between text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-white dark:bg-slate-800 rounded-lg flex items-center justify-center border border-slate-200 dark:border-white/10 shrink-0">
                        <ProductBrandAvatar
                          title={product.title}
                          category={product.category}
                          logo_url={product.logo_url}
                          size={24}
                          accentColor="#1877F2"
                        />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white leading-tight">{product.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{product.category}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-foreground text-base">{item.sales_count}</span>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Sales</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div id="payment-methods" className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-accent" />
          <h2 className="font-heading font-semibold text-sm text-foreground">Payment Methods</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <button
            onClick={() => togglePaymentMethod("flutterwaveEnabled")}
            disabled={pmLoading}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              pmSettings.flutterwaveEnabled ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-300/40 bg-transparent text-muted-foreground"
            }`}
          >
            <p className="text-sm font-semibold">Flutterwave</p>
            <p className="text-xs mt-1">{pmSettings.flutterwaveEnabled ? "✅ Enabled" : "❌ Disabled"}</p>
          </button>
          <button
            onClick={() => togglePaymentMethod("pocketfiEnabled")}
            disabled={pmLoading}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              pmSettings.pocketfiEnabled ? "border-sky-400/40 bg-sky-400/10 text-sky-400" : "border-slate-300/40 bg-transparent text-muted-foreground"
            }`}
          >
            <p className="text-sm font-semibold">PocketFi</p>
            <p className="text-xs mt-1">{pmSettings.pocketfiEnabled ? "✅ Enabled" : "❌ Disabled"}</p>
          </button>
          <button
            onClick={() => togglePaymentMethod("manualEnabled")}
            disabled={pmLoading}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              pmSettings.manualEnabled ? "border-amber-400/40 bg-amber-400/10 text-amber-400" : "border-slate-300/40 bg-transparent text-muted-foreground"
            }`}
          >
            <p className="text-sm font-semibold">Manual Transfer</p>
            <p className="text-xs mt-1">{pmSettings.manualEnabled ? "✅ Enabled" : "❌ Disabled"}</p>
          </button>
        </div>
        <div className="pt-1">
          <Button
            variant="outline"
            className="h-9 text-xs gap-2"
            disabled={pmLoading || reconcilingDeposits}
            onClick={() => void reconcilePendingDeposits()}
          >
            {reconcilingDeposits ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Reconcile Pending Deposits
          </Button>
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-heading font-semibold text-sm text-foreground">Site Announcement</h2>
          </div>
          <button
            onClick={() => {
              setAnnouncementActive(!announcementActive);
            }}
            className={`text-xs px-3 py-1.5 rounded-md font-semibold transition ${
              announcementActive ? "bg-accent/15 text-accent" : "bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300"
            }`}
          >
            {announcementActive ? "Active" : "Inactive"}
          </button>
        </div>
        <textarea
          value={announcementMsg}
          onChange={(e) => setAnnouncementMsg(e.target.value)}
          placeholder="Enter an announcement to display on user dashboard..."
          className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={saveAnnouncement}
            disabled={savingAnnouncement}
            className="h-9"
          >
            {savingAnnouncement ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Announcement
          </Button>
        </div>
      </div>

      {/* ── Live Users Table ─────────────────────────────────────────────── */}
      <div className="glass-card p-5">
        <UsersTable />
      </div>

      <WebhookVerificationsCard />

      {/* Recent orders */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/6">
          <h2 className="font-heading font-semibold text-foreground text-sm">Recent Orders</h2>
        </div>
        {orders.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-muted-foreground">No orders yet.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {orders.slice(0, 5).map((order) => (
              <div key={order.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="h-8 w-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                  {order.userName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{order.userName}</p>
                  <p className="text-xs text-muted-foreground truncate">{order.productTitle}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-accent">₦{order.amount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground/70">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stock overview */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/6">
          <h2 className="font-heading font-semibold text-foreground text-sm">Stock Overview</h2>
        </div>
        {products.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-muted-foreground">
            No products yet. Add products in the Product Manager.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {products.map((p) => (
              <div key={p.id} className="px-5 py-3.5 flex items-center gap-4">
                <ProductBrandAvatar
                  title={p.title}
                  category={p.category}
                  logo_url={p.logo_url}
                  size={36}
                  accentColor="#0ea5e9"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    ₦{p.price.toLocaleString()} per unit · {p.category}
                  </p>
                </div>
                <div className="shrink-0">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      resolveTotalStock(p) > 5
                        ? "bg-accent/15 text-accent border border-accent/20"
                        : resolveTotalStock(p) > 0
                        ? "bg-amber-400/15 text-amber-400 border border-amber-400/20"
                        : "bg-red-500/15 text-red-400 border border-red-500/20"
                    }`}
                  >
                    {resolveTotalStock(p)} in stock
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
