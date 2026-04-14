import { Link } from "react-router-dom";
import logo from "@/assets/logo-transparent.png";
import { useApp, type Product as AppProduct } from "@/context/AppContext";
import { ProductBrandAvatar } from "@/components/ProductBrandAvatar";
import { calculateStockBreakdown } from "@/lib/stock";
import {
  ArrowRight,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  Youtube,
  Star,
  BadgeCheck,
  Users,
  Clock,
  Zap,
  Shield,
  TrendingUp,
  Target,
  Globe,
  MessageCircle,
  Send,
  ChevronRight,
} from "lucide-react";

// ─── Contact links (update with your real handles) ────────────────────────────
const TELEGRAM_URL  = "https://t.me/davidgodwin10115";
const WHATSAPP_URL  = "https://wa.me/2348127692456";

// ─── Data ─────────────────────────────────────────────────────────────────────

const floatingIcons = [
  { icon: Facebook,  label: "Facebook",  color: "#1877F2", pos: "top-[12%] left-[6%]",  delay: ""           },
  { icon: Instagram, label: "Instagram", color: "#E1306C", pos: "top-[18%] right-[7%]", delay: "float-delay-1" },
  { icon: Twitter,   label: "Twitter/X", color: "#1DA1F2", pos: "top-[52%] left-[3%]",  delay: "float-delay-2" },
  { icon: Linkedin,  label: "LinkedIn",  color: "#0A66C2", pos: "top-[48%] right-[4%]", delay: "float-delay-3" },
  { icon: Youtube,   label: "YouTube",   color: "#FF0000", pos: "top-[75%] left-[8%]",  delay: "float-delay-4" },
  {
    icon: () => (
      <span className="text-sm font-bold leading-none" style={{ color: "#34d399" }}>TK</span>
    ),
    label: "TikTok",
    color: "#69C9D0",
    pos: "top-[72%] right-[7%]",
    delay: "float-delay-5",
  },
];

const stats = [
  { value: "5,000+",    label: "Happy Clients",     icon: Users   },
  { value: "24/7",      label: "Support Available",  icon: Clock   },
  { value: "Instant",   label: "Account Delivery",   icon: Zap     },
  { value: "100%",      label: "Secure Payments",    icon: Shield  },
];

const whyUs = [
  {
    num: "01",
    icon: BadgeCheck,
    title: "Instant Credibility",
    body: "Aged accounts from 2007–2024 carry real history, genuine activity, and platform trust — so you skip the 'new account' penalties from day one.",
  },
  {
    num: "02",
    icon: Zap,
    title: "Save Time & Effort",
    body: "Stop grinding for months to build account age and following. Get a ready-to-use account and focus on what actually matters — results.",
  },
  {
    num: "03",
    icon: Target,
    title: "Targeted Audience",
    body: "Many of our accounts already have followers in specific niches. Drop into a built-in audience instead of starting from zero.",
  },
  {
    num: "04",
    icon: Globe,
    title: "Strategic Expansion",
    body: "Break into new markets with local accounts that already have regional credibility. Expand your reach without rebuilding trust from scratch.",
  },
];

const curatedHotDeals = [
  { platform: "Facebook", title: "Aged Facebook Profile", category: "Social Media", year: "2010", price: "₦12,000", icon: Facebook, color: "#1877F2", liveStock: 14, manualStock: 0 },
  { platform: "Instagram", title: "Aged Instagram Profile", category: "Social Media", year: "2015", price: "₦8,500", icon: Instagram, color: "#E1306C", liveStock: 0, manualStock: 22 },
  { platform: "LinkedIn", title: "Aged LinkedIn Profile", category: "Social Media", year: "2012", price: "₦15,000", icon: Linkedin, color: "#0A66C2", liveStock: 9, manualStock: 0 },
  { platform: "Twitter / X", title: "Aged Twitter/X Profile", category: "Social Media", year: "2013", price: "₦10,000", icon: Twitter, color: "#1DA1F2", liveStock: 4, manualStock: 6 },
];

function resolvePlatformMeta(product: AppProduct) {
  const title = product.title.toLowerCase();
  if (title.includes("facebook")) return { platform: "Facebook", icon: Facebook, color: "#1877F2" };
  if (title.includes("instagram")) return { platform: "Instagram", icon: Instagram, color: "#E1306C" };
  if (title.includes("linkedin")) return { platform: "LinkedIn", icon: Linkedin, color: "#0A66C2" };
  if (title.includes("twitter") || title.includes(" x ")) return { platform: "Twitter / X", icon: Twitter, color: "#1DA1F2" };
  if (title.includes("youtube")) return { platform: "YouTube", icon: Youtube, color: "#FF0000" };
  return { platform: product.category || "Digital Asset", icon: BadgeCheck, color: "#34d399" };
}

const reviews = [
  { name: "ChimaOG",   comment: "Best place for aged IG logs! Super fast delivery.", rating: 5 },
  { name: "KingDave",  comment: "Legit accounts every time. Been buying for 6 months.", rating: 5 },
  { name: "AdaQueen",  comment: "Customer support is unmatched. Quick response always.", rating: 5 },
  { name: "TechBros",  comment: "Aged FB accounts working perfectly. Highly recommend.", rating: 5 },
];

// ─── Component ────────────────────────────────────────────────────────────────

const LandingPage = () => {
  const { currentUser, products } = useApp();
  const hasSession = Boolean(currentUser?.id);
  const walletBalance = Number(currentUser?.wallet_balance ?? 0);
  const productTimes = products
    .map((product) => {
      const t = new Date(product.createdAt).getTime();
      return Number.isFinite(t) ? t : 0;
    })
    .filter((t) => t > 0);
  const newestTime = productTimes.length > 0 ? Math.max(...productTimes) : 0;
  const oldestTime = productTimes.length > 0 ? Math.min(...productTimes) : 0;
  const timeSpan = Math.max(1, newestTime - oldestTime);

  const liveFeaturedDeals = products
    .map((product) => {
      const stock = calculateStockBreakdown(product);
      const platformMeta = resolvePlatformMeta(product);
      const createdTime = Number.isFinite(new Date(product.createdAt).getTime())
        ? new Date(product.createdAt).getTime()
        : 0;
      const recencySignal = productTimes.length > 0
        ? Math.max(0, Math.min(1, (createdTime - oldestTime) / timeSpan))
        : 0;
      // Availability weighting favors real live logs over manual-only inventory.
      const availabilitySignal = stock.live > 0
        ? Math.max(0.7, Math.min(1, stock.live / 10))
        : stock.manual > 0
          ? 0.35
          : 0;
      const featuredSignal = product.is_featured ? 1 : 0;
      const sortingScore =
        recencySignal * 40 +
        availabilitySignal * 40 +
        featuredSignal * 20;
      return {
        id: product.id,
        title: product.title,
        category: product.category,
        year: product.createdAt ? String(new Date(product.createdAt).getFullYear()) : "Recent",
        price: `₦${Number(product.price ?? 0).toLocaleString()}`,
        icon: platformMeta.icon,
        color: platformMeta.color,
        platform: platformMeta.platform,
        isFeatured: featuredSignal === 1,
        sortingScore,
        liveStock: stock.live,
        manualStock: stock.manual,
        totalStock: stock.total,
      };
    })
    .sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      if (b.sortingScore !== a.sortingScore) return b.sortingScore - a.sortingScore;
      return b.totalStock - a.totalStock;
    })
    .slice(0, 4);
  const featuredDeals = liveFeaturedDeals.length > 0 ? liveFeaturedDeals : curatedHotDeals;

  return (
    <div className="min-h-screen bg-[#080c14] text-white" style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif" }}>

      {/* ══════════════════════════════════════════════════════════════════════
          NAV
      ══════════════════════════════════════════════════════════════════════ */}
      <nav
        className="sticky top-0 z-50"
        style={{
          background: "rgba(5,8,15,0.82)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-20">
          <Link to="/" className="flex items-center ml-1">
            <img
              src={logo}
              alt="Elon Marketplace"
              className="h-12 w-auto object-contain"
              style={{ filter: "drop-shadow(0 0 8px rgba(16,185,129,0.3))" }}
            />
          </Link>
          <div className="flex items-center gap-3 mr-1">
            {hasSession && (
              <Link to="/dashboard/wallet">
                <button className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/15 transition-all duration-200">
                  My Wallet · ₦{walletBalance.toLocaleString()}
                </button>
              </Link>
            )}
            <Link to="/auth">
              <button className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-100 bg-white/10 border border-white/20 hover:bg-white/15 hover:text-white transition-all duration-200">
                Sign In
              </button>
            </Link>
            <Link to="/auth?tab=signup">
              <button className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-all duration-200 shadow-lg shadow-emerald-500/20">
                Get Started
              </button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO — floating icons + centered, simplified copy
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden section-dark min-h-[88vh] flex items-center">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 w-[700px] h-[500px] bg-emerald-500/10 blur-[130px] rounded-full" />
          <div className="absolute left-1/4 bottom-0 w-[400px] h-[300px] bg-blue-600/6 blur-[100px] rounded-full" />
          <div className="absolute right-1/4 top-1/3 w-[300px] h-[300px] bg-purple-600/5 blur-[100px] rounded-full" />
        </div>

        {/* Floating platform icons — hidden below md */}
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          {floatingIcons.map(({ icon: Icon, label, color, pos, delay }) => (
            <div
              key={label}
              className={`absolute ${pos} animate-float ${delay}`}
            >
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-md"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderColor: `${color}30`,
                  boxShadow: `0 0 16px ${color}12`,
                }}
              >
                <span style={{ color }}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-semibold text-white/60">{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Hero content */}
        <div className="relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-6 py-24 md:py-32 text-center">

          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold mb-10 animate-fade-up tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            Trusted by 5,000+ buyers across Nigeria &amp; beyond
          </div>

          {/* Headline */}
          <h1
            className="font-bold text-white mb-6 animate-fade-up animate-fade-up-1"
            style={{
              fontSize: "clamp(2.4rem, 6vw, 4.2rem)",
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
            }}
          >
            Premium Digital Assets,{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, #34d399, #10b981, #6ee7b7)" }}
            >
              Delivered Instantly.
            </span>
          </h1>

          {/* Sub-headline */}
          <p
            className="text-white/55 mx-auto mb-10 animate-fade-up animate-fade-up-2"
            style={{
              fontSize: "clamp(1rem, 2.2vw, 1.2rem)",
              lineHeight: 1.75,
              maxWidth: "560px",
            }}
          >
            Reliable. Secure. Fast. Access premium verified digital assets and receive delivery
            instantly in your dashboard after checkout.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up animate-fade-up-3">
            <Link to="/auth?tab=signup">
              <button className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-emerald-500 text-white font-bold text-base hover:bg-emerald-400 active:scale-95 transition-all duration-200 shadow-xl shadow-emerald-500/25">
                Explore Products <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <a href="#contact">
              <button className="w-full sm:w-auto px-8 py-4 rounded-xl border border-white/20 text-white/80 bg-white/5 font-semibold text-base hover:border-white/40 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-200">
                Contact Us
              </button>
            </a>
          </div>

          {/* Platform pills — mobile only (since floating icons are hidden on small screens) */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2 md:hidden animate-fade-up">
            {["Facebook", "Instagram", "Twitter/X", "LinkedIn", "YouTube", "TikTok"].map((p) => (
              <span key={p} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/50 font-medium">
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          STATS BAR
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-[#0a0f1a] border-y border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-white/5">
            {stats.map(({ value, label, icon: Icon }) => (
              <div key={label} className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
                <Icon className="h-5 w-5 text-emerald-500/60 mb-1" />
                <p
                  className="font-bold text-white"
                  style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", lineHeight: 1, letterSpacing: "-0.02em" }}
                >
                  {value}
                </p>
                <p className="text-xs text-white/40 font-medium uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          WHY US — 4-column numbered grid
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="section-dark py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">

          {/* Section header */}
          <div className="text-center mb-16">
            <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-3">Why Choose Us</p>
            <h2
              className="font-bold text-white mb-4"
              style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1.2, letterSpacing: "-0.02em" }}
            >
              Everything you need to get started
            </h2>
            <p className="text-white/45 max-w-md mx-auto" style={{ fontSize: "1rem", lineHeight: 1.75 }}>
              We built Elon Marketplace for buyers who value quality, speed, and simplicity.
            </p>
          </div>

          {/* 4-column grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {whyUs.map(({ num, icon: Icon, title, body }) => (
              <div
                key={num}
                className="card-lift group relative rounded-2xl p-6 flex flex-col gap-4"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                {/* Number */}
                <span
                  className="absolute top-5 right-5 font-bold opacity-10 group-hover:opacity-20 transition-opacity"
                  style={{ fontSize: "3.5rem", lineHeight: 1, color: "#34d399", letterSpacing: "-0.04em" }}
                >
                  {num}
                </span>

                {/* Icon */}
                <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-emerald-400" />
                </div>

                {/* Text */}
                <div>
                  <h3
                    className="font-bold text-white mb-2"
                    style={{ fontSize: "1.05rem", lineHeight: 1.3 }}
                  >
                    {title}
                  </h3>
                  <p className="text-white/45" style={{ fontSize: "0.875rem", lineHeight: 1.75 }}>
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          HOT DEALS
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="section-dark-2 py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">

          <div className="text-center mb-14">
            <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-3">Available Now</p>
            <h2
              className="font-bold text-white mb-3"
              style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1.2, letterSpacing: "-0.02em" }}
            >
              Featured Products
            </h2>
            <p className="text-white/45" style={{ fontSize: "1rem", lineHeight: 1.75 }}>
              Sign up to unlock live pricing and full stock details.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {featuredDeals.map((d) => {
              const Icon = d.icon;
              const totalStock = d.liveStock + d.manualStock;
              const manualOnly = d.liveStock === 0 && d.manualStock > 0;
              return (
                <div
                  key={"id" in d ? d.id : d.platform}
                  className="card-lift rounded-2xl p-6 flex flex-col backdrop-blur-xl"
                  style={{
                    background: "linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))",
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 bg-white/80">
                      <ProductBrandAvatar
                        title={d.title}
                        category={d.category}
                        size={34}
                        accentColor={d.color}
                      />
                    </div>
                    <div
                      className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${d.color}18`, border: `1px solid ${d.color}30` }}
                    >
                      <Icon className="h-4 w-4" style={{ color: d.color }} />
                    </div>
                  </div>
                  <h3 className="font-bold text-white mb-1.5" style={{ fontSize: "1rem" }}>
                    {d.title}
                  </h3>
                  <p className="text-xs text-white/35 mb-4">Created {d.year} · Verified</p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {totalStock > 0 && !manualOnly && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-400/30">
                        Ready for Delivery
                      </span>
                    )}
                    {manualOnly && (
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-400/30">
                        Manual Stock ({d.manualStock})
                      </span>
                    )}
                  </div>
                  <p
                    className="font-bold text-emerald-400 mb-5 mt-auto"
                    style={{ fontSize: "1.5rem", letterSpacing: "-0.02em" }}
                  >
                    {d.price}
                  </p>
                  <Link to="/auth?tab=signup">
                    <button className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/65 text-sm font-semibold hover:bg-white/10 hover:text-white transition-all duration-200">
                      View Details <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          TESTIMONIALS
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="section-dark py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">

          <div className="text-center mb-14">
            <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-3">Testimonials</p>
            <h2
              className="font-bold text-white"
              style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1.2, letterSpacing: "-0.02em" }}
            >
              What Our Buyers Say
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {reviews.map((r) => (
              <div
                key={r.name}
                className="card-lift rounded-2xl p-6 flex flex-col"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-white/55 flex-1 mb-5" style={{ fontSize: "0.875rem", lineHeight: 1.75 }}>
                  "{r.comment}"
                </p>
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold shrink-0">
                    {r.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{r.name}</p>
                    <div className="flex items-center gap-1 text-emerald-500 text-xs">
                      <BadgeCheck className="h-3 w-3" /> Verified Buyer
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          CTA BANNER
      ══════════════════════════════════════════════════════════════════════ */}
      <section className="section-dark-2 py-24 md:py-32 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/8 blur-[100px] rounded-full" />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-5">Get Started Today</p>
          <h2
            className="font-bold text-white mb-5"
            style={{ fontSize: "clamp(1.8rem, 4.5vw, 3.2rem)", lineHeight: 1.15, letterSpacing: "-0.02em" }}
          >
            Ready to scale your operations?
          </h2>
          <p className="text-white/45 mb-10" style={{ fontSize: "1.05rem", lineHeight: 1.75 }}>
            Join 5,000+ buyers. Instant access. No delays. Real accounts — verified and aged.
          </p>
          <Link to="/auth?tab=signup">
            <button className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-emerald-500 text-white font-bold text-base hover:bg-emerald-400 active:scale-95 transition-all duration-200 shadow-2xl shadow-emerald-500/25">
              Create Free Account <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          CONTACT SECTION (anchor target for "Contact Us" hero button)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="contact" className="section-dark py-20 border-t border-white/5">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-emerald-400 text-sm font-bold uppercase tracking-widest mb-4">Get In Touch</p>
          <h2
            className="font-bold text-white mb-3"
            style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)", lineHeight: 1.2, letterSpacing: "-0.02em" }}
          >
            We're here to help
          </h2>
          <p className="text-white/45 mb-10" style={{ fontSize: "1rem", lineHeight: 1.75 }}>
            Have a question about an order or need help choosing the right account? Reach us directly — our team replies fast.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full sm:w-auto px-8 py-4 rounded-xl font-bold text-sm text-white transition-all duration-200 active:scale-95"
              style={{ background: "#2AABEE", boxShadow: "0 4px 24px rgba(42,171,238,0.25)" }}
            >
              <Send className="h-4 w-4" />
              Chat on Telegram
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full sm:w-auto px-8 py-4 rounded-xl font-bold text-sm text-white transition-all duration-200 active:scale-95"
              style={{ background: "#25D366", boxShadow: "0 4px 24px rgba(37,211,102,0.25)" }}
            >
              <MessageCircle className="h-4 w-4" />
              Chat on WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════════════════ */}
      <footer className="bg-[#05080f] border-t border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">

            {/* Col 1 — Brand */}
            <div className="col-span-2 md:col-span-1">
              <img
                src={logo}
                alt="Elon Marketplace"
                className="h-9 w-auto object-contain mb-4"
                style={{ filter: "drop-shadow(0 0 6px rgba(74,222,128,0.25))" }}
              />
              <p className="text-sm text-white/35 leading-relaxed mb-5" style={{ lineHeight: 1.75 }}>
                Premium aged social media accounts delivered instantly to your dashboard.
              </p>
              <div className="flex gap-2.5">
                {[Facebook, Instagram, Twitter, Linkedin].map((Icon, i) => (
                  <a
                    key={i}
                    href="#"
                    className="h-8 w-8 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center text-white/35 transition-all duration-200 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400"
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px rgba(74,222,128,0.25)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = "none")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </a>
                ))}
              </div>
            </div>

            {/* Col 2 — Products */}
            <div>
              <h4 className="font-semibold text-white/80 text-xs mb-4 uppercase tracking-wider">Products</h4>
              <ul className="space-y-2.5">
                {["Facebook Accounts", "Instagram Accounts", "LinkedIn Accounts", "Netflix Accounts", "Telegram Accounts", "HMA VPN Accounts"].map((item) => (
                  <li key={item}>
                    <Link to="/auth?tab=signup" className="text-sm text-white/35 hover:text-white transition-colors duration-150">
                      {item}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 3 — Support */}
            <div>
              <h4 className="font-semibold text-white/80 text-xs mb-4 uppercase tracking-wider">Support</h4>
              <ul className="space-y-2.5">
                {[
                  { label: "Sign In",        to: "/auth" },
                  { label: "Create Account", to: "/auth?tab=signup" },
                  { label: "Contact Us",     to: "#contact" },
                ].map((item) => (
                  <li key={item.label}>
                    <a href={item.to} className="text-sm text-white/35 hover:text-white transition-colors duration-150">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 4 — Legal */}
            <div>
              <h4 className="font-semibold text-white/80 text-xs mb-4 uppercase tracking-wider">Legal</h4>
              <ul className="space-y-2.5">
                {["Privacy Policy", "Terms of Service", "Refund Policy"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-white/35 hover:text-white transition-colors duration-150">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/20">© 2026 Elon Marketplace. All rights reserved.</p>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/8 border border-emerald-500/15">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-emerald-400/80">Server Status: Operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
