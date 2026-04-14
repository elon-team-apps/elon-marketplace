import { Outlet, Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useState } from "react";
import logo from "@/assets/logo-transparent.png";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  CreditCard,
  Wallet,
  Settings,
  Headphones,
  Menu,
  X,
  BarChart3,
  Users,
  ShieldCheck,
  ChevronRight,
  Upload,
  RefreshCw,
  Home,
  Sun,
  Moon,
  ToggleLeft,
  ToggleRight,
  SlidersHorizontal,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useTheme } from "@/hooks/useTheme";

// ── Nav items ──────────────────────────────────────────────────────────────
const userNav = [
  { label: "Dashboard",  icon: LayoutDashboard, path: "/dashboard",          exact: true  },
  { label: "Products",   icon: Package,          path: "/dashboard/products", exact: false },
  { label: "My Orders",  icon: ClipboardList,    path: "/dashboard/orders",   exact: false },
  { label: "Payments",   icon: CreditCard,       path: "/dashboard/payments", exact: false },
  { label: "Wallet",     icon: Wallet,           path: "/dashboard/wallet",   exact: false },
  { label: "Settings",   icon: Settings,         path: "/dashboard/settings", exact: false },
  { label: "Support",    icon: Headphones,       path: "/dashboard/support",  exact: false },
];

const adminNav = [
  { label: "Analytics",          icon: BarChart3,     path: "/dashboard/admin",            exact: true  },
  { label: "Payment Methods",    icon: SlidersHorizontal, path: "/dashboard/admin#payment-methods", exact: false },
  { label: "User Management",    icon: Users,         path: "/dashboard/admin/users",      exact: false },
  { label: "Deposit Requests",   icon: Wallet,        path: "/dashboard/admin/deposits",   exact: false },
  { label: "Inventory / Upload", icon: Upload,        path: "/dashboard/admin/products",   exact: false },
  { label: "Order Audit",        icon: ClipboardList, path: "/dashboard/admin/orders",     exact: false },
];

// ── NavItem helper ─────────────────────────────────────────────────────────
function NavItem({
  label, icon: Icon, path, exact, onClick, amber = false,
}: {
  label: string; icon: React.ElementType; path: string;
  exact: boolean; onClick?: () => void; amber?: boolean;
}) {
  const location = useLocation();
  const active = exact
    ? location.pathname === path
    : location.pathname.startsWith(path);

  return (
    <Link
      to={path}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
        active
          ? amber
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
            : "bg-accent/15 text-accent"
          : amber
            ? "text-slate-500 hover:bg-amber-500/10 hover:text-amber-700 dark:hover:text-amber-300"
            : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-800 dark:hover:text-slate-200"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 leading-none">{label}</span>
      {active && <ChevronRight className="h-3 w-3 opacity-40" />}
    </Link>
  );
}

// ── DashboardLayout ────────────────────────────────────────────────────────
const DashboardLayout = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const {
    currentUser,
    profileLoaded,
    isAdmin,
    isAdminView,
    toggleAdminView,
    refreshProfile,
    profileSyncWarning,
    clearSessionAndHardRefresh,
  } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const isSuperAdmin = currentUser?.email?.trim().toLowerCase() === "growthprofesors@gmail.com";
  const canAccessAdmin = isAdmin || isSuperAdmin;
  const usingEmailAdminFallback = !isAdmin && isSuperAdmin;

  const close = () => setSidebarOpen(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshProfile();
    setRefreshing(false);
  };

  // Loading gate — wait for Supabase auth to resolve
  if (!profileLoaded) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-slate-900 border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground font-medium">Loading your account…</p>
      </div>
    );
  }

  // Auth guard — if profile loaded but no user ID, session is gone → redirect to auth.
  // This eliminates "ghost sessions" after clearing cookies or token expiry.
  if (!currentUser.id) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Mobile overlay ─────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={close}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside
        className={`
          fixed md:sticky top-0 left-0 z-50 h-screen w-64 flex flex-col
          overflow-hidden transition-transform duration-300 md:translate-x-0
          glass-sidebar
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo row */}
        <div className="flex items-center justify-between h-20 px-4 border-b border-slate-200 dark:border-white/5 shrink-0">
          <Link to="/dashboard" onClick={close}>
            <img
              src={logo}
              alt="Elon Marketplace"
              className="h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(16,185,129,0.35)]"
            />
          </Link>
          <button
            onClick={close}
            className="md:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">

          {/* User nav */}
          {userNav.map((item) => (
            <NavItem key={item.path} {...item} onClick={close} />
          ))}

          {/* ── Admin Panel — only when profile.is_admin (or legacy role admin) via useApp().isAdmin ─────── */}
          {canAccessAdmin && (
            <div className="pt-4 mt-2 border-t border-slate-200 dark:border-white/5">
              {/* Section header */}
              <div className="flex items-center gap-2 px-3 mb-2">
                <ShieldCheck className="h-3 w-3 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
                  Admin Panel
                </span>
              </div>

              {/* Admin links */}
              {adminNav.map((item) => (
                <NavItem key={item.path} {...item} onClick={close} amber />
              ))}
            </div>
          )}
        </nav>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="shrink-0 p-3 border-t border-slate-200 dark:border-white/5 space-y-1">
          {/* Admin view toggle — only visible to admins */}
          {canAccessAdmin && (
            <button
              onClick={() => {
                toggleAdminView();
                navigate(isAdminView ? "/dashboard" : "/dashboard/admin");
                close();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/20"
            >
              {isAdminView ? (
                <ToggleRight className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ToggleLeft className="h-3.5 w-3.5 shrink-0" />
              )}
              {isAdminView ? "Exit Admin View" : "Switch to Admin"}
            </button>
          )}

          <Link
            to="/"
            onClick={close}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 dark:text-slate-600 hover:text-slate-700 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/4 transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            Back to Home
          </Link>
          {isSuperAdmin && (
            <span className="block px-3 pt-1 text-[8px] opacity-20">SuperAdmin Active</span>
          )}
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {profileSyncWarning && (
          <div
            role="alert"
            className="shrink-0 px-4 py-2.5 border-b border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <div className="max-w-4xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <p className="text-xs sm:text-sm leading-snug min-w-0">
                <span className="font-semibold">Account data warning.</span>{" "}
                {profileSyncWarning} You can still use the app; admin tools stay enabled for approved admin email accounts.
              </p>
              {usingEmailAdminFallback && (
                <span className="inline-flex items-center rounded-md border border-amber-700/30 bg-amber-100/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:border-amber-400/40 dark:bg-amber-900/40 dark:text-amber-200">
                  Email-based admin fallback
                </span>
              )}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void refreshProfile()}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/30 bg-white/90 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-white dark:bg-amber-900/30 dark:text-amber-50 dark:hover:bg-amber-900/50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Retry sync
                </button>
                <button
                  type="button"
                  onClick={() => void clearSessionAndHardRefresh()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  Hard refresh session
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Glass header */}
        <header className="sticky top-0 z-30 glass-nav h-16 flex items-center px-4 md:px-6 gap-3 shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Mobile logo */}
          <Link to="/dashboard" className="md:hidden flex items-center" onClick={close}>
            <img src={logo} alt="Logo" className="h-10 w-auto object-contain" />
          </Link>

          {/* Admin badge (desktop) */}
          {canAccessAdmin && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
              <ShieldCheck className="h-3 w-3 text-amber-500 dark:text-amber-400" />
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 tracking-wide">Admin</span>
            </div>
          )}

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Live refresh */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh balance from Supabase"
              className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-600 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-accent" : ""}`} />
            </button>

            {/* Balance chip — shows skeleton while role is still loading */}
            <div
              className="bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-lg px-3 py-1.5 text-right cursor-pointer hover:bg-slate-200 dark:hover:bg-white/8 transition-colors min-w-[72px]"
              onClick={handleRefresh}
              title="Click to sync balance"
            >
              <span className="text-[9px] text-slate-500 block leading-none mb-0.5 uppercase tracking-wide">
                Balance
              </span>
              {currentUser.role === "" ? (
                <div className="h-3.5 w-14 rounded bg-slate-300 dark:bg-white/10 animate-pulse" />
              ) : (
                <p className="font-heading font-bold text-sm leading-none text-accent">
                  ₦{(currentUser.wallet_balance ?? 0).toLocaleString()}
                </p>
              )}
            </div>

            {/* Avatar */}
            <button
              onClick={() => navigate("/dashboard/settings")}
              className="h-8 w-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent text-xs font-bold shrink-0 hover:bg-accent/30 transition-colors"
              title={currentUser?.email ?? ""}
            >
              {currentUser?.name
                ? currentUser.name.charAt(0).toUpperCase()
                : currentUser?.email
                  ? currentUser.email.charAt(0).toUpperCase()
                  : "?"}
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-6 pt-7 md:pt-10 pb-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
