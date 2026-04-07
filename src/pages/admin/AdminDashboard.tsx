import { useState, useEffect } from "react";
import {
  TrendingUp, Users, Package, ShoppingCart, ArrowUpRight,
  Crown, Loader2, RefreshCw, Plus, Minus, Search, Wallet,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────

type Profile = {
  id: string;
  email: string;
  wallet_balance: number;
  role: string;
  created_at: string;
};

type PaymentMethodSettings = {
  pocketfi_enabled: boolean;
  manual_enabled: boolean;
};

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
      .select("id, email, wallet_balance, role, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load users", description: error.message, variant: "destructive" });
    } else if (data) {
      setProfiles(data as Profile[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      const { error } = await supabase
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", adjusting.userId);

      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      setProfiles((prev) =>
        prev.map((p) => (p.id === adjusting.userId ? { ...p, wallet_balance: newBalance } : p))
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
                            {profile.role === "admin" && (
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
                          profile.role === "admin"
                            ? "bg-amber-500/15 border border-amber-500/25 text-amber-600 dark:text-amber-400"
                            : "bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/8 text-slate-500"
                        }`}
                      >
                        {profile.role || "user"}
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
  const { products, users, orders } = useApp();
  const { toast } = useToast();
  const [pmSettings, setPmSettings] = useState<PaymentMethodSettings>({
    pocketfi_enabled: true,
    manual_enabled: false,
  });
  const [pmLoading, setPmLoading] = useState(false);

  const totalRevenue = orders.reduce((sum, o) => sum + o.amount, 0);
  const totalLogsSold = orders.length;
  const totalUsers = users.filter((u) => !u.is_admin).length;
  const activeStock = products.reduce((sum, p) => sum + p.stock, 0);

  const stats = [
    {
      label: "Total Revenue",
      value: `₦${totalRevenue.toLocaleString()}`,
      icon: TrendingUp,
      color: "text-accent",
      bg: "bg-accent/10",
      change: `${orders.length} orders`,
    },
    {
      label: "Logs Sold",
      value: totalLogsSold.toString(),
      icon: ShoppingCart,
      color: "text-sky-400",
      bg: "bg-sky-400/10",
      change: "total deliveries",
    },
    {
      label: "Registered Users",
      value: totalUsers.toString(),
      icon: Users,
      color: "text-amber-400",
      bg: "bg-amber-400/10",
      change: "active accounts",
    },
    {
      label: "Active Stock",
      value: activeStock.toString(),
      icon: Package,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
      change: `across ${products.length} products`,
    },
  ];

  const fetchPaymentSettings = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("payment_method_settings")
      .select("pocketfi_enabled, manual_enabled")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) setPmSettings(data as PaymentMethodSettings);
  }, []);

  useEffect(() => {
    fetchPaymentSettings();
  }, [fetchPaymentSettings]);

  const togglePaymentMethod = async (field: "pocketfi_enabled" | "manual_enabled") => {
    if (!supabase) return;
    setPmLoading(true);
    const next = { ...pmSettings, [field]: !pmSettings[field] };
    const { error } = await supabase
      .from("payment_method_settings")
      .update(next)
      .eq("id", 1);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      setPmLoading(false);
      return;
    }
    setPmSettings(next);
    setPmLoading(false);
  };

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
            <p className="font-heading text-2xl font-bold text-foreground mb-0.5">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{s.change}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-accent" />
          <h2 className="font-heading font-semibold text-sm text-foreground">Payment Methods</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            onClick={() => togglePaymentMethod("pocketfi_enabled")}
            disabled={pmLoading}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              pmSettings.pocketfi_enabled ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-300/40 bg-transparent text-muted-foreground"
            }`}
          >
            <p className="text-sm font-semibold">PocketFi</p>
            <p className="text-xs mt-1">{pmSettings.pocketfi_enabled ? "Enabled" : "Disabled"}</p>
          </button>
          <button
            onClick={() => togglePaymentMethod("manual_enabled")}
            disabled={pmLoading}
            className={`rounded-lg border px-4 py-3 text-left transition ${
              pmSettings.manual_enabled ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-300/40 bg-transparent text-muted-foreground"
            }`}
          >
            <p className="text-sm font-semibold">Manual Transfer</p>
            <p className="text-xs mt-1">{pmSettings.manual_enabled ? "Enabled" : "Disabled"}</p>
          </button>
        </div>
      </div>

      {/* ── Live Users Table ─────────────────────────────────────────────── */}
      <div className="glass-card p-5">
        <UsersTable />
      </div>

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
                <div className="h-8 w-8 rounded-md bg-sky-400/10 border border-sky-400/15 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-sky-500 dark:text-sky-400">{p.category}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground">₦{p.price.toLocaleString()} per unit</p>
                </div>
                <div className="shrink-0">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      p.stock > 5
                        ? "bg-accent/15 text-accent border border-accent/20"
                        : p.stock > 0
                        ? "bg-amber-400/15 text-amber-400 border border-amber-400/20"
                        : "bg-red-500/15 text-red-400 border border-red-500/20"
                    }`}
                  >
                    {p.stock} in stock
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
