import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Wallet,
  CreditCard,
  ClipboardList,
  Headphones,
  Package,
  ArrowRight,
  Menu,
  Send,
  MessageCircle,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { calculateStock } from "@/lib/stock";

const BTN_NAVY = "#0f172a";
const TEXT_BLACK = "#000000";
const TEXT_WHITE = "#ffffff";

const announcementSlides = [
  {
    line:
      "ANNOUNCEMENT: KINDLY NOTE: ALL USERS MUST JOIN OUR TELEGRAM CHANNEL TO BE UPDATED WITH ANY CHANGES.",
    icon: Megaphone,
    iconClass: "text-red-500 shrink-0",
  },
  {
    line:
      "ANNOUNCEMENT: Keep recovery details secure immediately after delivery to protect your purchased digital products.",
    icon: ShieldCheck,
    iconClass: "text-white shrink-0",
  },
];

export default function DashboardHome() {
  const { currentUser, orders, products } = useApp();
  const [activeSlide, setActiveSlide] = useState(0);

  const myOrders = orders.filter((o) => o.userId === currentUser?.id);
  const totalSpent = myOrders.reduce((s, o) => s + o.amount, 0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % announcementSlides.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

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
      value: products.filter((p) => calculateStock(p) > 0).length.toString(),
      icon: Package,
      color: "text-purple-400",
      bg: "bg-purple-400/10 border-purple-400/20",
      href: "/dashboard/products",
    },
  ];

  const firstName = currentUser?.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-4">
      {/* Sticky mobile-first top strip */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 rounded-2xl border border-slate-200 dark:border-white/10 p-3.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: BTN_NAVY }}>
              <Wallet className="h-4 w-4" />
            </div>
            <p className="font-extrabold text-sm truncate text-slate-900 dark:text-white">
              ELON MARKETPLACE
            </p>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full px-4 py-2 text-base font-extrabold tabular-nums text-white whitespace-nowrap shadow-sm"
            style={{ background: BTN_NAVY }}
          >
            ₦{" "}
            {(currentUser?.wallet_balance ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </button>

          <div className="flex justify-end">
            <button
              type="button"
              className="h-9 w-9 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4 text-slate-900 dark:text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Announcement carousel — deep navy card, white copy */}
      <section
        className="rounded-2xl border border-white/10 p-4 shadow-md overflow-hidden"
        style={{ backgroundColor: BTN_NAVY }}
      >
        <div className="relative min-h-[5.25rem] overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSlide}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -40, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex gap-2.5 items-start"
            >
              {(() => {
                const slide = announcementSlides[activeSlide];
                const Icon = slide.icon;
                return (
                  <>
                    <Icon className={`h-5 w-5 mt-0.5 ${slide.iconClass}`} aria-hidden />
                    <p
                      className="text-[13px] sm:text-sm font-semibold leading-snug flex-1 min-w-0"
                      style={{ color: TEXT_WHITE }}
                    >
                      {slide.line}
                    </p>
                  </>
                );
              })()}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-3 flex items-center justify-start gap-1.5">
          {announcementSlides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Go to announcement ${idx + 1}`}
              onClick={() => setActiveSlide(idx)}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: activeSlide === idx ? 18 : 8,
                background: activeSlide === idx ? TEXT_WHITE : "rgba(255,255,255,0.28)",
              }}
            />
          ))}
        </div>
      </section>

      {/* Social cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a
          href="https://t.me/Elonmarketplace99"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4 flex items-center gap-4 shadow-sm transition-all hover:scale-[1.01] active:scale-95 group"
        >
          <div className="h-12 w-12 rounded-xl bg-sky-100 dark:bg-sky-500/10 flex items-center justify-center shrink-0 group-hover:bg-sky-500/20 transition-colors">
            <Send className="h-6 w-6 text-sky-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              Telegram Channel
            </p>
            <p className="text-[10px] font-extrabold text-sky-500 tracking-tight uppercase">
              STAY UPDATED AT ALL TIMES
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-sky-500 transition-colors" />
        </a>

        <a
          href="https://t.me/Elonmarketplace99"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-4 flex items-center gap-4 shadow-sm transition-all hover:scale-[1.01] active:scale-95 group"
        >
          <div className="h-12 w-12 rounded-xl bg-sky-100 dark:bg-sky-500/10 flex items-center justify-center shrink-0 group-hover:bg-sky-500/20 transition-colors">
            <Send className="h-6 w-6 text-sky-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              Telegram Support
            </p>
            <p className="text-[10px] font-extrabold text-sky-500 tracking-tight uppercase">
              REPLIES IN MINUTES
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-sky-500 transition-colors" />
        </a>
      </section>

      <div>
        <h1 className="font-heading text-2xl font-bold text-black dark:text-white">
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
            className="glass-card rounded-2xl p-5 flex flex-col gap-4 hover:border-white/14 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className={`h-10 w-10 rounded-xl border ${s.bg} flex items-center justify-center`}>
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
      <div className="glass-card rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
        <div className="glass-card rounded-2xl overflow-hidden">
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
      <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
        <div className="h-10 w-10 rounded-xl bg-sky-400/10 border border-sky-400/20 flex items-center justify-center shrink-0">
          <Headphones className="h-5 w-5 text-sky-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-200">Need help?</p>
          <p className="text-xs text-slate-500 mt-0.5">Telegram support — usually responds in minutes.</p>
        </div>
        <Link to="/dashboard/support" className="shrink-0 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors">
          Contact →
        </Link>
      </div>
    </div>
  );
}
