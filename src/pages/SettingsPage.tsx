import { useState } from "react";
import { Settings, User, Mail, Wallet, ShieldCheck, LogOut, Loader2, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const { currentUser, isAdmin } = useApp();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    if (supabase) {
      await supabase.auth.signOut();
    }
    navigate("/");
  };

  const rows = [
    {
      icon: User,
      label: "Display Name",
      value: currentUser?.name || "—",
    },
    {
      icon: Mail,
      label: "Email Address",
      value: currentUser?.email || "—",
      mono: true,
    },
    {
      icon: Wallet,
      label: "Wallet Balance",
      value: `₦${(currentUser?.wallet_balance ?? 0).toLocaleString()}`,
      accent: true,
    },
    {
      icon: ShieldCheck,
      label: "Account Role",
      value: isAdmin ? "Administrator" : "Standard User",
      isAdmin: isAdmin,
    },
    {
      icon: Calendar,
      label: "Member Since",
      value: currentUser?.createdAt
        ? new Date(currentUser.createdAt).toLocaleDateString("en-GB", {
            day: "2-digit", month: "long", year: "numeric",
          })
        : "—",
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5">
          <Settings className="h-6 w-6 text-accent" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Your account profile and preferences</p>
      </div>

      {/* Avatar + name hero */}
      <div className="glass-card px-6 py-5 flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold shrink-0">
          {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : "?"}
        </div>
        <div>
          <p className="font-heading font-bold text-lg leading-tight">{currentUser?.name || "User"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{currentUser?.email || ""}</p>
          {isAdmin && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-400 text-xs font-bold">
              <ShieldCheck className="h-3 w-3" />
              Admin
            </span>
          )}
        </div>
      </div>

      {/* Profile detail rows */}
      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-heading font-semibold">Profile Details</h2>
        </div>
        <div className="divide-y">
          {rows.map(({ icon: Icon, label, value, mono, accent, isAdmin }) => (
            <div key={label} className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-white/6 border border-white/8 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/25 text-amber-400 text-xs font-bold">
                    Admin
                  </span>
                )}
                <span
                  className={[
                    "text-sm font-semibold",
                    mono ? "font-mono text-xs" : "",
                    accent ? "text-accent" : "",
                  ].join(" ")}
                >
                  {value}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sign out */}
      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-heading font-semibold">Account Actions</h2>
        </div>
        <div className="px-6 py-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Sign Out</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ends your session and returns you to the home page.
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2 shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <LogOut className="h-4 w-4" />}
            {loggingOut ? "Signing out…" : "Sign Out"}
          </Button>
        </div>
      </div>
    </div>
  );
}
