import { useState, useEffect } from "react";
import {
  Search, Plus, Minus, Crown, Loader2, RefreshCw,
  Users, X, Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Profile = {
  id:             string;
  email:          string;
  wallet_balance: number;
  role:           string;
  is_admin?:      boolean;
  created_at:     string;
};

function profileIsAdmin(p: Pick<Profile, "role" | "is_admin">): boolean {
  return p.is_admin === true || (p.role ?? "").toLowerCase() === "admin";
}

// ── Top-up Dialog ─────────────────────────────────────────────────────────────
function TopUpDialog({
  profile,
  onClose,
  onSuccess,
}: {
  profile: Profile;
  onClose: () => void;
  onSuccess: (userId: string, newBalance: number) => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount]   = useState("");
  const [saving, setSaving]   = useState(false);

  const parsed = parseInt(amount, 10);

  const handleAction = async (type: "add" | "deduct") => {
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
      return;
    }
    if (!supabase) return;

    const newBalance =
      type === "add"
        ? profile.wallet_balance + parsed
        : profile.wallet_balance - parsed;

    if (newBalance < 0) {
      toast({
        title: "Cannot go below zero",
        description: `Max deductible: ₦${profile.wallet_balance.toLocaleString()}`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ wallet_balance: newBalance })
      .eq("id", profile.id);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({
      title: type === "add" ? "Funds added" : "Funds deducted",
      description: `₦${parsed.toLocaleString()} ${type === "add" ? "credited to" : "debited from"} ${profile.email}. New balance: ₦${newBalance.toLocaleString()}.`,
    });
    onSuccess(profile.id, newBalance);
    setSaving(false);
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-card w-full max-w-sm p-6 space-y-5 relative">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
            {profile.email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{profile.email}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Wallet className="h-3 w-3" />
              Current balance: <strong className="text-accent">₦{profile.wallet_balance.toLocaleString()}</strong>
            </p>
          </div>
        </div>

        {/* Amount input */}
        <div>
          <Label htmlFor="topup-amount" className="mb-1.5 block">Amount (₦)</Label>
          <Input
            id="topup-amount"
            type="number"
            min={1}
            placeholder="e.g. 5000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !saving) handleAction("add");
            }}
            autoFocus
          />
          {parsed > 0 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              After add: <span className="text-accent font-semibold">₦{(profile.wallet_balance + parsed).toLocaleString()}</span>
              {" · "}
              After deduct: <span className="text-destructive font-semibold">
                ₦{Math.max(0, profile.wallet_balance - parsed).toLocaleString()}
              </span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => handleAction("add")}
            disabled={saving || !amount || parsed <= 0}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Funds
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => handleAction("deduct")}
            disabled={saving || !amount || parsed <= 0}
          >
            <Minus className="h-4 w-4" />
            Deduct
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AdminUsers() {
  const { toast } = useToast();

  const [profiles, setProfiles]   = useState<Profile[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [topUpTarget, setTopUpTarget] = useState<Profile | null>(null);

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

  useEffect(() => { fetchProfiles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel("admin-users-profiles-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles" },
        (payload) => {
          const inserted = payload.new as Profile;
          setProfiles((prev) => {
            if (prev.some((p) => p.id === inserted.id)) return prev;
            return [inserted, ...prev];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const updated = payload.new as Partial<Profile> & { id: string };
          setProfiles((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
          );
          setTopUpTarget((prev) => {
            if (!prev || prev.id !== updated.id) return prev;
            return { ...prev, ...updated };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "profiles" },
        (payload) => {
          const deleted = payload.old as Partial<Profile> & { id?: string };
          if (!deleted.id) return;
          setProfiles((prev) => prev.filter((p) => p.id !== deleted.id));
          setTopUpTarget((prev) => (prev && prev.id === deleted.id ? null : prev));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = profiles.filter((p) =>
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleTopUpSuccess = (userId: string, newBalance: number) => {
    setProfiles((prev) =>
      prev.map((p) => p.id === userId ? { ...p, wallet_balance: newBalance } : p)
    );
  };

  return (
    <>
      {/* Top-up dialog (portal-like overlay) */}
      {topUpTarget && (
        <TopUpDialog
          profile={topUpTarget}
          onClose={() => setTopUpTarget(null)}
          onSuccess={handleTopUpSuccess}
        />
      )}

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
            placeholder="Search by email…"
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
                    <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Role</th>
                    <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Balance</th>
                    <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden lg:table-cell">Joined</th>
                    <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Top-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {filtered.map((profile) => (
                    <tr key={profile.id} className="hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">

                      {/* User */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {(profile.email || "?").charAt(0).toUpperCase()}
                          </div>
                          <p className="font-medium text-xs flex items-center gap-1.5 leading-tight">
                            {profile.email}
                            {profileIsAdmin(profile) && (
                              <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                          </p>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${
                          profileIsAdmin(profile)
                            ? "bg-amber-500/15 border-amber-500/25 text-amber-600 dark:text-amber-400"
                            : "bg-slate-100 dark:bg-white/8 border-transparent text-slate-500 dark:text-slate-400"
                        }`}>
                          {profileIsAdmin(profile) ? "admin" : (profile.role || "user")}
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

                      {/* Top-up button */}
                      <td className="px-5 py-4 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTopUpTarget(profile)}
                          className="h-8 text-xs gap-1.5 text-accent border-accent/30 hover:bg-accent/10"
                        >
                          <Wallet className="h-3 w-3" />
                          Top-up
                        </Button>
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
    </>
  );
}
