import { useState, useEffect, useRef } from "react";
import { CreditCard, ArrowDownLeft, CheckCircle2, Clock, XCircle, Loader2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useApp } from "@/context/AppContext";
import { Link, useSearchParams } from "react-router-dom";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, refreshProfile } = useApp();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshedForRef = useRef<string | null>(null);

  const paystackRefParam =
    searchParams.get("reference")?.trim() ||
    searchParams.get("trxref")?.trim() ||
    searchParams.get("tx_ref")?.trim() ||
    "";

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

  /** After Paystack redirect (deposits or purchases), poll until the row completes then sync header balance. */
  useEffect(() => {
    if (!paystackRefParam || !supabase || !currentUser?.id || !UUID_REGEX.test(currentUser.id)) return;
    if (refreshedForRef.current === paystackRefParam) return;

    let timer: number | undefined;
    let cancelled = false;

    const clearPaystackQueryParams = () => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete("reference");
          n.delete("trxref");
          n.delete("tx_ref");
          return n;
        },
        { replace: true },
      );
    };

    const poll = async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("status")
        .eq("reference", paystackRefParam)
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        timer = window.setTimeout(poll, 4000);
        return;
      }

      const st = data.status as string;
      if (st === "completed") {
        refreshedForRef.current = paystackRefParam;
        await refreshProfile();
        clearPaystackQueryParams();
        supabase
          .from("transactions")
          .select("id, amount, status, reference, created_at")
          .eq("user_id", currentUser.id)
          .eq("type", "deposit")
          .order("created_at", { ascending: false })
          .then(({ data: rows }) => {
            if (rows) setDeposits(rows as Deposit[]);
          });
        return;
      }

      if (st === "failed") {
        refreshedForRef.current = paystackRefParam;
        clearPaystackQueryParams();
        return;
      }

      timer = window.setTimeout(poll, 3000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [paystackRefParam, currentUser?.id, refreshProfile, setSearchParams]);

  const totalDeposited = deposits
    .filter((d) => d.status === "completed")
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 text-slate-900 shadow-sm space-y-6 dark:border-slate-200">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5 text-slate-900">
          <CreditCard className="h-6 w-6 text-accent" />
          Payment History
        </h1>
        <p className="text-sm text-slate-600 mt-1">All wallet top-ups and deposit records</p>
      </div>

      {/* Summary stat */}
      {!loading && deposits.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <ArrowDownLeft className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-slate-600 uppercase tracking-wide font-semibold">Total Deposited</p>
              <p className="font-heading font-bold text-xl text-accent mt-0.5">₦{totalDeposited.toLocaleString()}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-slate-500" />
            </div>
            <div>
              <p className="text-xs text-slate-600 uppercase tracking-wide font-semibold">Transactions</p>
              <p className="font-heading font-bold text-xl mt-0.5 text-slate-900">{deposits.length}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 text-slate-500" />
            </div>
            <div>
              <p className="text-xs text-slate-600 uppercase tracking-wide font-semibold">Current Balance</p>
              <p className="font-heading font-bold text-xl mt-0.5 text-slate-900">₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-sm text-slate-600">Loading payment history…</p>
          </div>
        ) : deposits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="h-16 w-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center">
              <ArrowDownLeft className="h-7 w-7 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-800">No deposits yet</p>
              <p className="text-sm text-slate-600 mt-1">
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
            <table className="w-full text-sm text-slate-900">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-3.5 text-left font-semibold text-slate-600">Reference</th>
                  <th className="px-5 py-3.5 text-right font-semibold text-slate-600">Amount</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-slate-600">Status</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-slate-600 hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {deposits.map((dep) => {
                  const cfg = STATUS[dep.status as keyof typeof STATUS] ?? STATUS.pending;
                  const Icon = cfg.icon;
                  return (
                    <tr key={dep.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-mono text-xs text-slate-800">
                          {dep.reference ?? dep.id.slice(-12).toUpperCase()}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 md:hidden">
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
                      <td className="px-5 py-4 text-center text-slate-600 text-xs hidden md:table-cell whitespace-nowrap">
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
