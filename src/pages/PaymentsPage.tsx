import { useState, useEffect } from "react";
import { CreditCard, ArrowDownLeft, CheckCircle2, Clock, XCircle, Loader2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useApp } from "@/context/AppContext";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Deposit = {
  id: string;
  amount: number;
  status: string;
  reference: string | null;
  created_at: string;
};

const STATUS = {
  completed: { label: "Completed", icon: CheckCircle2, cls: "bg-accent/10 text-accent border-accent/20" },
  pending:   { label: "Pending",   icon: Clock,        cls: "bg-warning/10 text-warning border-warning/20" },
  failed:    { label: "Failed",    icon: XCircle,      cls: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function PaymentsPage() {
  const { currentUser } = useApp();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supabase || !currentUser?.id || !UUID_REGEX.test(currentUser.id)) return;
    setLoading(true);
    supabase
      .from("transactions")
      .select("id, amount, status, reference, created_at")
      .eq("user_id", currentUser.id)
      .eq("type", "deposit")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setDeposits(data as Deposit[]);
        setLoading(false);
      });
  }, [currentUser?.id]);

  const totalDeposited = deposits
    .filter((d) => d.status === "completed")
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5">
          <CreditCard className="h-6 w-6 text-accent" />
          Payment History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">All wallet top-ups and deposit records</p>
      </div>

      {/* Summary stat */}
      {!loading && deposits.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="glass-card p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <ArrowDownLeft className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Total Deposited</p>
              <p className="font-heading font-bold text-xl text-accent mt-0.5">₦{totalDeposited.toLocaleString()}</p>
            </div>
          </div>
          <div className="glass-card p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-white/6 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Transactions</p>
              <p className="font-heading font-bold text-xl mt-0.5">{deposits.length}</p>
            </div>
          </div>
          <div className="glass-card p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-white/6 flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Current Balance</p>
              <p className="font-heading font-bold text-xl mt-0.5">₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading payment history…</p>
          </div>
        ) : deposits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="h-16 w-16 rounded-2xl bg-white/6 flex items-center justify-center">
              <ArrowDownLeft className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-foreground/60">No deposits yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Top up your wallet to start purchasing accounts.
              </p>
            </div>
            <Link to="/dashboard/wallet">
              <Button variant="outline" className="gap-2 mt-1">
                Top Up Wallet
              </Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-white/3">
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">Reference</th>
                  <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Amount</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Status</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deposits.map((dep) => {
                  const cfg = STATUS[dep.status as keyof typeof STATUS] ?? STATUS.pending;
                  const Icon = cfg.icon;
                  return (
                    <tr key={dep.id} className="hover:bg-white/3 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-mono text-xs text-foreground/70">
                          {dep.reference ?? dep.id.slice(-12).toUpperCase()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 md:hidden">
                          {new Date(dep.created_at).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-accent whitespace-nowrap">
                        ₦{dep.amount.toLocaleString()}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.cls}`}>
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center text-muted-foreground text-xs hidden md:table-cell whitespace-nowrap">
                        {new Date(dep.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
