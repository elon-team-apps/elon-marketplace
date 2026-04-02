import { useState, useEffect } from "react";
import { Search, Plus, Minus, Crown, Loader2, RefreshCw, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Profile = {
  id: string;
  email: string;
  wallet_balance: number;
  role: string;
  created_at: string;
};

export default function AdminUsers() {
  const { adjustWallet } = useApp();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
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

    // ── Supabase path: update profiles.wallet_balance directly ────────────────
    if (supabase) {
      const target = profiles.find((p) => p.id === adjusting.userId);
      if (!target) { setSaving(false); return; }

      const newBalance =
        adjusting.type === "add"
          ? target.wallet_balance + parsed
          : target.wallet_balance - parsed;

      if (newBalance < 0) {
        toast({ title: "Cannot go below zero", description: "Deduct amount exceeds current balance.", variant: "destructive" });
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

      // Reflect change locally without a full refetch
      setProfiles((prev) =>
        prev.map((p) => (p.id === adjusting.userId ? { ...p, wallet_balance: newBalance } : p))
      );
      toast({
        title: adjusting.type === "add" ? "Funds added" : "Funds deducted",
        description: `₦${parsed.toLocaleString()} ${adjusting.type === "add" ? "credited to" : "debited from"} ${target.email}.`,
      });
    } else {
      // ── Offline fallback ──────────────────────────────────────────────────
      const result = adjustWallet(adjusting.userId, parsed, adjusting.type);
      toast({
        title: result.success ? "Success" : "Error",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    }

    setSaving(false);
    setAdjusting(null);
    setAmount("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Users className="h-6 w-6 text-accent" />
            Users &amp; Wallets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All registered profiles — {profiles.length} total
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={fetchProfiles}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading && profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading profiles from database…</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/6 bg-slate-50/50 dark:bg-white/4">
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">User</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground hidden md:table-cell">Email</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Role</th>
                  <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Balance</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden lg:table-cell">Joined</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filtered.map((profile) => (
                  <tr key={profile.id} className="hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">

                    {/* Name + avatar */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {(profile.email || "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 leading-tight text-xs">
                            {profile.email}
                            {profile.role === "admin" && (
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-5 py-4 text-muted-foreground text-xs hidden md:table-cell max-w-[180px]">
                      <span className="truncate block">{profile.email}</span>
                    </td>

                    {/* Role badge */}
                    <td className="px-5 py-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ${
                          profile.role === "admin"
                            ? "bg-amber-500/15 border border-amber-500/25 text-amber-600 dark:text-amber-400"
                            : "bg-slate-100 dark:bg-white/8 text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {profile.role || "user"}
                      </span>
                    </td>

                    {/* Balance */}
                    <td className="px-5 py-4 text-right font-bold text-accent whitespace-nowrap">
                      ₦{(profile.wallet_balance ?? 0).toLocaleString()}
                    </td>

                    {/* Joined */}
                    <td className="px-5 py-4 text-center text-muted-foreground text-xs hidden lg:table-cell whitespace-nowrap">
                      {profile.created_at
                        ? new Date(profile.created_at).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })
                        : "—"}
                    </td>

                    {/* Wallet actions */}
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {adjusting?.userId === profile.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              placeholder="Amount (₦)"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              className="h-8 w-28 text-xs"
                              min={1}
                              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={handleConfirm}
                              disabled={saving}
                              className="h-8 text-xs gap-1"
                            >
                              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "OK"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setAdjusting(null); setAmount(""); }}
                              className="h-8 text-xs"
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
                              className="h-8 text-xs gap-1 text-accent border-accent/30 hover:bg-accent/10"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setAdjusting({ userId: profile.id, type: "deduct" }); setAmount(""); }}
                              className="h-8 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
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
              <div className="py-12 text-center text-sm text-muted-foreground">
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
