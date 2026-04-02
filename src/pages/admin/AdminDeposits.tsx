import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, CheckCircle, XCircle, Clock,
  ExternalLink, Inbox, BadgeDollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────
type DepositStatus = "pending" | "completed" | "rejected";

type Deposit = {
  id:             string;
  user_id:        string;
  amount:         number;
  status:         DepositStatus;
  screenshot_url: string | null;
  note:           string | null;
  created_at:     string;
  // joined from profiles
  user_email:     string;
};

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: DepositStatus }) {
  const map: Record<DepositStatus, { label: string; className: string }> = {
    pending:   { label: "Pending",   className: "bg-amber-500/15  text-amber-600  dark:text-amber-400  border-amber-500/25" },
    completed: { label: "Approved",  className: "bg-accent/15     text-accent     border-accent/25" },
    rejected:  { label: "Rejected",  className: "bg-red-500/15    text-red-600    dark:text-red-400   border-red-500/25" },
  };
  const { label, className } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border ${className}`}>
      {label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminDeposits() {
  const { toast } = useToast();
  const [deposits, setDeposits]   = useState<Deposit[]>([]);
  const [loading, setLoading]     = useState(false);
  const [acting, setActing]       = useState<string | null>(null); // deposit id being acted on
  const [filter, setFilter]       = useState<DepositStatus | "all">("pending");

  // ── Fetch deposits with user email ─────────────────────────────────────────
  const fetchDeposits = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    // Fetch deposits + join profiles for email
    const { data, error } = await supabase
      .from("deposits")
      .select("id, user_id, amount, status, screenshot_url, note, created_at, profiles(email)")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load deposits", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const mapped: Deposit[] = (data ?? []).map((row: any) => ({
      id:             row.id,
      user_id:        row.user_id,
      amount:         row.amount,
      status:         row.status as DepositStatus,
      screenshot_url: row.screenshot_url ?? null,
      note:           row.note ?? null,
      created_at:     row.created_at,
      user_email:     row.profiles?.email ?? row.user_id,
    }));

    setDeposits(mapped);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchDeposits(); }, [fetchDeposits]);

  // ── Approve deposit ────────────────────────────────────────────────────────
  const handleApprove = async (deposit: Deposit) => {
    if (!supabase) return;
    setActing(deposit.id);

    const { data, error } = await supabase.rpc("approve_deposit", {
      p_deposit_id: deposit.id,
    });

    if (error || !data?.success) {
      toast({
        title: "Approval failed",
        description: error?.message ?? data?.message ?? "Unknown error",
        variant: "destructive",
      });
      setActing(null);
      return;
    }

    // Update local state
    setDeposits((prev) =>
      prev.map((d) => d.id === deposit.id ? { ...d, status: "completed" } : d)
    );
    toast({
      title: "Deposit approved",
      description: `₦${deposit.amount.toLocaleString()} added to ${deposit.user_email}'s wallet.`,
    });
    setActing(null);
  };

  // ── Reject deposit ─────────────────────────────────────────────────────────
  const handleReject = async (deposit: Deposit) => {
    if (!supabase) return;
    setActing(deposit.id);

    const { error } = await supabase
      .from("deposits")
      .update({ status: "rejected" })
      .eq("id", deposit.id);

    if (error) {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
      setActing(null);
      return;
    }

    setDeposits((prev) =>
      prev.map((d) => d.id === deposit.id ? { ...d, status: "rejected" } : d)
    );
    toast({ title: "Deposit rejected", description: `Request from ${deposit.user_email} rejected.` });
    setActing(null);
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const visible = filter === "all" ? deposits : deposits.filter((d) => d.status === filter);
  const pendingCount = deposits.filter((d) => d.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5">
            <BadgeDollarSign className="h-6 w-6 text-accent" />
            Deposit Requests
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and approve manual bank transfer deposits.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={fetchDeposits} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/5 w-fit">
        {(["pending", "all", "completed", "rejected"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
              filter === tab
                ? "bg-white dark:bg-white/10 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-accent/20 text-accent text-[9px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading && deposits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading deposit requests…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Inbox className="h-10 w-10 opacity-30" />
            <p className="text-sm">No {filter === "all" ? "" : filter} deposits found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/6 bg-slate-50/50 dark:bg-white/4">
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">User</th>
                  <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Amount</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Status</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden md:table-cell">Screenshot</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground hidden lg:table-cell">Note</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden md:table-cell">Date</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {visible.map((dep) => {
                  const isActing = acting === dep.id;
                  return (
                    <tr key={dep.id} className="hover:bg-slate-50 dark:hover:bg-white/3 transition-colors">
                      {/* User */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {dep.user_email.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-medium text-foreground max-w-[160px] truncate">
                            {dep.user_email}
                          </span>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-4 text-right font-bold text-accent whitespace-nowrap">
                        ₦{dep.amount.toLocaleString()}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4 text-center">
                        <StatusBadge status={dep.status} />
                      </td>

                      {/* Screenshot */}
                      <td className="px-5 py-4 text-center hidden md:table-cell">
                        {dep.screenshot_url ? (
                          <a
                            href={dep.screenshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Note */}
                      <td className="px-5 py-4 text-xs text-muted-foreground hidden lg:table-cell max-w-[180px]">
                        <span className="truncate block">{dep.note || "—"}</span>
                      </td>

                      {/* Date */}
                      <td className="px-5 py-4 text-center text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">
                        {new Date(dep.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                        <br />
                        <span className="text-[10px]">
                          {new Date(dep.created_at).toLocaleTimeString("en-GB", {
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-center gap-2">
                          {dep.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleApprove(dep)}
                                disabled={isActing}
                                className="h-8 text-xs gap-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                              >
                                {isActing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-3 w-3" />
                                )}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReject(dep)}
                                disabled={isActing}
                                className="h-8 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                              >
                                <XCircle className="h-3 w-3" />
                                Reject
                              </Button>
                            </>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {dep.status === "completed" ? (
                                <CheckCircle className="h-3.5 w-3.5 text-accent" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5 text-destructive" />
                              )}
                              {dep.status === "completed" ? "Approved" : "Rejected"}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary row */}
      {deposits.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-500" />
            {pendingCount} pending
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-accent" />
            {deposits.filter((d) => d.status === "completed").length} approved
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
            {deposits.filter((d) => d.status === "rejected").length} rejected
          </span>
        </div>
      )}
    </div>
  );
}
