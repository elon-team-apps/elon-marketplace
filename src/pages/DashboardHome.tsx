import { Wallet, CreditCard, ClipboardList, Headphones, Package, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "@/context/AppContext";

export default function DashboardHome() {
  const { currentUser, orders, products } = useApp();

  const myOrders = orders.filter((o) => o.userId === currentUser?.id);
  const totalSpent = myOrders.reduce((s, o) => s + o.amount, 0);

  const stats = [
    {
      label: "Wallet Balance",
      value: `₦${(currentUser?.wallet_balance ?? 0).toLocaleString()}`,
      icon: Wallet,
      color: "text-accent",
      bg: "bg-accent/10 border-accent/20",
      href: "/dashboard/wallet",
    },
    {
      label: "Total Spent",
      value: `₦${totalSpent.toLocaleString()}`,
      icon: CreditCard,
      color: "text-sky-400",
      bg: "bg-sky-400/10 border-sky-400/20",
      href: "/dashboard/payments",
    },
    {
      label: "My Orders",
      value: myOrders.length.toString(),
      icon: ClipboardList,
      color: "text-amber-400",
      bg: "bg-amber-400/10 border-amber-400/20",
      href: "/dashboard/orders",
    },
    {
      label: "In Stock",
      value: products.filter((p) => p.stock > 0).length.toString(),
      icon: Package,
      color: "text-purple-400",
      bg: "bg-purple-400/10 border-purple-400/20",
      href: "/dashboard/products",
    },
  ];

  const firstName = currentUser?.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-white">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your Elon Marketplace account overview.
        </p>
      </div>

      {/* Live stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            to={s.href}
            className="glass-card p-5 flex flex-col gap-4 hover:border-white/14 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className={`h-10 w-10 rounded-lg border ${s.bg} flex items-center justify-center`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
            </div>
            <div>
              <p className="font-heading text-2xl font-bold text-white leading-none mb-1">
                {s.value}
              </p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* CTA banner */}
      <div className="glass-card p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1">
          <h2 className="font-heading text-base font-semibold text-white mb-1">
            Fund your wallet to get started
          </h2>
          <p className="text-sm text-slate-500">
            Browse aged Facebook, Instagram, LinkedIn &amp; more — instant delivery after purchase.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/dashboard/wallet"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent/90 text-white text-sm font-semibold transition-colors"
          >
            <Wallet className="h-4 w-4" /> Fund Wallet
          </Link>
          <Link
            to="/dashboard/products"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold transition-colors"
          >
            Browse
          </Link>
        </div>
      </div>

      {/* Recent orders (only if any exist) */}
      {myOrders.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/6 flex items-center justify-between">
            <h3 className="font-heading text-sm font-semibold text-slate-200">Recent Orders</h3>
            <Link to="/dashboard/orders" className="text-xs text-accent hover:text-accent/80 font-medium">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-white/5">
            {myOrders.slice(0, 3).map((order) => (
              <div key={order.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/15 flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{order.productTitle}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className="text-sm font-bold text-accent shrink-0">
                  ₦{order.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support */}
      <div className="glass-card p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-lg bg-sky-400/10 border border-sky-400/20 flex items-center justify-center shrink-0">
          <Headphones className="h-5 w-5 text-sky-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-200">Need help?</p>
          <p className="text-xs text-slate-500 mt-0.5">Telegram or WhatsApp support — usually responds in minutes.</p>
        </div>
        <Link to="/dashboard/support" className="shrink-0 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors">
          Contact →
        </Link>
      </div>
    </div>
  );
}
