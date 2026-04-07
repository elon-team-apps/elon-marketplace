import { useState, useRef, useEffect } from "react";
import {
  X, Eye, ShoppingCart, CheckCircle, AlertCircle, Loader2,
  Minus, Plus, Wallet, ChevronDown, ChevronUp, LayoutGrid, Shield,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useApp, Product } from "@/context/AppContext";

const CATEGORIES = ["Social Media", "Streaming", "VPN"] as const;
const LOGO_MAP: Record<string, string> = {
  HMA: "https://www.hidemyass.com/en-us/index/assets/img/hma-logo-color.svg",
  NORD: "https://upload.wikimedia.org/wikipedia/commons/f/f9/NordVPN_Logo.png",
  EXPRESS: "https://upload.wikimedia.org/wikipedia/commons/7/7a/ExpressVPN_logo.png",
  NETFLIX: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Netflix-new-icon.png",
  TALKATONE: "https://static.wikia.nocookie.net/logopedia/images/4/40/Talkatone_2017.png",
};

function getMappedLogoFromTitle(title: string) {
  const upper = (title || "").toUpperCase();
  const key = Object.keys(LOGO_MAP).find((k) => upper.includes(k));
  return key ? LOGO_MAP[key] : null;
}

function normalizeCategory(raw: string, title: string) {
  const category = (raw || "").toLowerCase();
  const lowerTitle = (title || "").toLowerCase();
  if (category.includes("social") || ["fb", "ig", "li", "tw", "tk", "yt", "telegram"].includes(category)) return "Social Media";
  if (category.includes("stream") || lowerTitle.includes("netflix")) return "Streaming";
  if (category.includes("vpn") || lowerTitle.includes("hma") || lowerTitle.includes("hidemyass")) return "VPN";
  return "Social Media";
}

function inferPlatformKey(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("facebook")) return "FB";
  if (lower.includes("instagram")) return "IG";
  if (lower.includes("linkedin")) return "LI";
  if (lower.includes("twitter") || lower.includes("x ")) return "TW";
  if (lower.includes("tiktok")) return "TK";
  if (lower.includes("youtube")) return "YT";
  if (lower.includes("telegram")) return "TW";
  if (lower.includes("netflix")) return "YT";
  if (lower.includes("hma") || lower.includes("nord") || lower.includes("express") || lower.includes("vpn")) return "";
  return "";
}

// ─── Platform registry ────────────────────────────────────────────────────────

const PLATFORMS: {
  key: string;
  label: string;
  color: string;         // used for price text + top bar in light mode
  darkColor?: string;    // overrides color in dark mode (for dark-on-dark issues)
  glow: string;
  logoUrl: string | null;
  svgFallback: React.ReactNode;
}[] = [
  {
    key: "FB",
    label: "Facebook",
    color: "#1877F2",
    glow: "rgba(24,119,242,0.3)",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b8/2021_Facebook_icon.svg?v=2",
    svgFallback: (
      <svg viewBox="0 0 24 24" fill="#1877F2" className="w-full h-full">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
      </svg>
    ),
  },
  {
    key: "IG",
    label: "Instagram",
    color: "#E1306C",
    glow: "rgba(225,48,108,0.3)",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg?v=2",
    svgFallback: (
      <svg viewBox="0 0 24 24" className="w-full h-full">
        <defs>
          <linearGradient id="ig-fb" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f09433"/>
            <stop offset="50%" stopColor="#dc2743"/>
            <stop offset="100%" stopColor="#bc1888"/>
          </linearGradient>
        </defs>
        <path fill="url(#ig-fb)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
      </svg>
    ),
  },
  {
    key: "TW",
    label: "Twitter / X",
    color: "#e7e9ea",
    glow: "rgba(255,255,255,0.2)",
    logoUrl: null,
    svgFallback: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full text-slate-800 dark:text-white">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    key: "LI",
    label: "LinkedIn",
    color: "#0A66C2",
    glow: "rgba(10,102,194,0.3)",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png",
    svgFallback: (
      <svg viewBox="0 0 24 24" fill="#0A66C2" className="w-full h-full">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
  {
    key: "TK",
    label: "TikTok",
    color: "#010101",       // black in light mode
    darkColor: "#d1d5db",   // light gray so it's visible on dark backgrounds
    glow: "rgba(0,0,0,0.15)",
    logoUrl: null,
    // Official TikTok music-note shape — black body with cyan + red shadows
    svgFallback: (
      <svg viewBox="0 0 24 24" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        {/* Red shadow layer */}
        <path fill="#EE1D52" opacity="0.9" d="M12.653.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" transform="translate(0.4, 0.4)"/>
        {/* Cyan shadow layer */}
        <path fill="#69C9D0" opacity="0.9" d="M12.653.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" transform="translate(-0.4, -0.4)"/>
        {/* Black body on top */}
        <path fill="#010101" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
  },
  {
    key: "YT",
    label: "YouTube",
    color: "#FF0000",
    glow: "rgba(255,0,0,0.3)",
    logoUrl: null,
    svgFallback: (
      <svg viewBox="0 0 24 24" fill="#FF0000" className="w-full h-full">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    key: "iCloud",
    label: "iCloud",
    color: "#3b82f6",
    glow: "rgba(59,130,246,0.3)",
    logoUrl: null,
    svgFallback: (
      <svg viewBox="0 0 24 24" fill="#3b82f6" className="w-full h-full">
        <path d="M13.75 2a5.25 5.25 0 015.17 4.37A4.25 4.25 0 0117 14.5H6.5a4.5 4.5 0 01-.5-8.97A5.25 5.25 0 0113.75 2z"/>
      </svg>
    ),
  },
];

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

// ─── Platform logo component ──────────────────────────────────────────────────

function PlatformLogo({
  product,
  platform,
  size = 40,
}: {
  product: Product;
  platform: (typeof PLATFORMS)[number] | undefined;
  size?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const dim = `${size}px`;
  const mappedSrc = getMappedLogoFromTitle(product.title);
  const src = mappedSrc || null;

  return (
    <div
      className="rounded-lg overflow-hidden flex items-center justify-center shrink-0"
      style={{
        width: dim,
        height: dim,
        background: "#f8f9fa",
        border: `1.5px solid ${platform?.color ?? "#ccc"}30`,
        padding: 2,
      }}
    >
      {src && !imgFailed ? (
        <img
          src={src}
          alt={platform?.label ?? product.category}
          className="w-full h-full object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Shield className="h-4 w-4 text-slate-500" />
        </div>
      )}
    </div>
  );
}

// ─── Purchase modal ────────────────────────────────────────────────────────────

type PurchaseState =
  | { phase: "idle" }
  | { phase: "success"; logs: string[]; count: number }
  | { phase: "error"; message: string };

function PurchaseModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { currentUser, purchaseProduct } = useApp();
  const [qty, setQty] = useState(1);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>({ phase: "idle" });
  const [purchasing, setPurchasing] = useState(false);

  const maxQty = Math.min(product.stock, 10);
  const total = qty * product.price;
  const balance = currentUser?.wallet_balance ?? 0;
  const canAfford = balance >= total;
  const platform = PLATFORM_MAP[inferPlatformKey(product.title)];

  const handlePurchase = async () => {
    setPurchasing(true);
    setPurchaseState({ phase: "idle" });
    const logs: string[] = [];
    let purchased = 0;
    for (let i = 0; i < qty; i++) {
      const result = await purchaseProduct(product.id);
      if (!result.success) {
        setPurchaseState({ phase: "error", message: result.message });
        if (result.message.toLowerCase().includes("out of stock")) {
          setQty(1);
        }
        setPurchasing(false);
        return;
      }
      purchased++;
      if (result.deliveredLog) logs.push(result.deliveredLog);
    }
    setPurchasing(false);
    setPurchaseState({ phase: "success", logs, count: purchased });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden bg-white dark:bg-[#0a0e1a] shadow-2xl"
        style={{ border: "1px solid rgba(0,0,0,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {purchaseState.phase === "success" ? (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center shrink-0">
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Purchase Successful!</h3>
                <p className="text-xs text-slate-500 dark:text-white/45">
                  {purchaseState.count} account{purchaseState.count > 1 ? "s" : ""} delivered
                </p>
              </div>
            </div>
            <div className="rounded-xl p-4 space-y-3 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/15">
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400/70">Your Credentials</p>
              {purchaseState.logs.map((log, i) => (
                <div key={i} className="rounded-lg p-3 bg-white dark:bg-black/40 border border-emerald-100 dark:border-white/6">
                  <p className="text-[11px] text-slate-400 dark:text-white/35 mb-1">Account {i + 1}</p>
                  <p className="font-mono text-xs text-emerald-700 dark:text-emerald-300 break-all select-all leading-relaxed">{log}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-white/35 text-center">
              Save these credentials. They're also in your{" "}
              <Link to="/dashboard/orders" className="text-primary underline underline-offset-2" onClick={onClose}>Orders</Link>.
            </p>
            <button onClick={onClose} className="w-full py-3 rounded-xl text-sm font-bold text-slate-500 dark:text-white/60 border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/7">
              <div className="flex items-center gap-3">
                <PlatformLogo product={product} platform={platform} size={40} />
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-tight pr-2 line-clamp-1">{product.title}</h3>
                  <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{product.stock} available · {platform?.label ?? product.category}</p>
                </div>
              </div>
              <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:text-white/35 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/8 transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-widest mb-3">Select Quantity</p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    className="h-10 w-10 rounded-xl border border-slate-200 dark:border-white/12 flex items-center justify-center text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/8 transition-colors disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="flex-1 text-center">
                    <span className="font-bold text-3xl text-slate-900 dark:text-white">{qty}</span>
                    <span className="text-sm text-slate-400 dark:text-white/35 ml-2">account{qty > 1 ? "s" : ""}</span>
                  </div>
                  <button
                    onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                    disabled={qty >= maxQty}
                    className="h-10 w-10 rounded-xl border border-slate-200 dark:border-white/12 flex items-center justify-center text-slate-500 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/8 transition-colors disabled:opacity-30"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {maxQty >= 3 && (
                  <div className="flex gap-2 mt-3">
                    {[1, 2, 3, 5, 10].filter((n) => n <= maxQty).map((n) => (
                      <button
                        key={n}
                        onClick={() => setQty(n)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all duration-150 ${
                          qty === n
                            ? "bg-primary/10 border-primary/40 text-primary"
                            : "bg-slate-50 dark:bg-white/4 border-slate-200 dark:border-white/8 text-slate-500 dark:text-white/40"
                        }`}
                      >
                        ×{n}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl p-4 space-y-2.5 bg-slate-50 dark:bg-white/3 border border-slate-200 dark:border-white/7">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Unit price</span>
                  <span className="font-semibold text-slate-900 dark:text-white/80">₦{product.price.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Quantity</span>
                  <span className="font-semibold text-slate-900 dark:text-white/80">× {qty}</span>
                </div>
                <div className="border-t border-slate-200 dark:border-white/10 pt-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-slate-900 dark:text-white text-sm">Total</span>
                    <span className="font-extrabold text-xl text-emerald-600 dark:text-emerald-400">
                      ₦{total.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 dark:text-white/35 flex items-center gap-1.5">
                  <Wallet className="h-3 w-3" /> Your balance
                </span>
                <span className={`font-bold ${canAfford ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                  ₦{balance.toLocaleString()}
                </span>
              </div>

              {purchaseState.phase === "error" && (
                <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-600 dark:text-red-400">{purchaseState.message}</p>
                </div>
              )}

              {!canAfford && product.stock > 0 && (
                <p className="text-xs text-slate-400 dark:text-white/35 text-center">
                  Need ₦{(total - balance).toLocaleString()} more.{" "}
                  <Link to={`/dashboard/wallet?amount=${Math.max(100, total - balance)}`} onClick={onClose} className="text-primary dark:text-emerald-400 underline underline-offset-2">
                    Fund with PocketFi →
                  </Link>
                </p>
              )}

              <button
                onClick={handlePurchase}
                disabled={product.stock === 0 || purchasing || !canAfford || purchaseState.phase === "error" && purchaseState.message.toLowerCase().includes("out of stock")}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-primary hover:bg-primary/90"
                style={{ boxShadow: (!purchasing && canAfford) ? "0 4px 14px rgba(17,32,112,0.3)" : "none" }}
              >
                {purchasing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processing{qty > 1 ? ` ${qty} accounts` : ""}…</>
                ) : (
                  <><Eye className="h-4 w-4" /> Buy {qty} Account{qty > 1 ? "s" : ""} · ₦{total.toLocaleString()}</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Category dropdown ────────────────────────────────────────────────────────

function CategoryDropdown({
  categories,
  active,
  productCount,
  onChange,
}: {
  categories: readonly string[];
  active: string | null;
  productCount: (key: string) => number;
  onChange: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activePlatform = active ? { label: active } : null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm text-white transition-all duration-150 active:scale-95"
        style={{
          background: "hsl(var(--primary))",
          boxShadow: "0 2px 8px rgba(17,32,112,0.25)",
        }}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        <span>{activePlatform ? activePlatform.label : "Category"}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-30 rounded-xl overflow-hidden w-56 shadow-xl"
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          {/* All */}
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors ${
              !active
                ? "bg-primary text-white"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            ALL PRODUCTS
          </button>

          {categories.map((cat) => {
            const count = productCount(cat);
            const isActive = active === cat;
            return (
              <button
                key={cat}
                onClick={() => { onChange(isActive ? null : cat); setOpen(false); }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors border-t border-slate-100 ${
                  isActive
                    ? "bg-primary/8 font-semibold"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
                style={{ color: isActive ? "hsl(var(--primary))" : undefined }}
              >
                <span className="font-medium">{cat.toUpperCase()}</span>
                <span className="text-[11px] text-slate-400 font-normal">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { products, currentUser } = useApp();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [buyProduct, setBuyProduct] = useState<Product | null>(null);

  const productsWithCategory = products.map((p) => ({ ...p, category: normalizeCategory(p.category, p.title) }));
  const presentKeys = Array.from(new Set(productsWithCategory.map((p) => p.category)));
  const displayCategories = CATEGORIES.filter((c) => presentKeys.includes(c));

  const filteredProducts = activeCategory
    ? productsWithCategory.filter((p) => p.category === activeCategory)
    : productsWithCategory;

  const activePlatform = activeCategory ? { label: activeCategory } : null;

  // Group products by category for "All" view
  const grouped: { platform: { label: string } | undefined; key: string; items: Product[] }[] = [];
  if (!activeCategory) {
    presentKeys.forEach((key) => {
      const items = productsWithCategory.filter((p) => p.category === key);
      if (items.length > 0) grouped.push({ key, platform: { label: key }, items });
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Browse and purchase social media accounts</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Balance */}
          <div className="rounded-xl px-4 py-2.5 text-right bg-primary/8 border border-primary/15">
            <p className="text-[10px] text-primary/70 leading-none mb-1 uppercase tracking-widest font-semibold">Balance</p>
            <p className="font-bold text-base leading-none text-primary">
              ₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* ── Category dropdown button ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <CategoryDropdown
          categories={displayCategories.length > 0 ? displayCategories : CATEGORIES}
          active={activeCategory}
          productCount={(key) => productsWithCategory.filter((p) => p.category === key).length}
          onChange={setActiveCategory}
        />
        {activeCategory && (
          <button
            onClick={() => setActiveCategory(null)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* ── Product content ──────────────────────────────────────────────────── */}
      {activeCategory ? (
        /* Filtered by single category */
        <div>
          {/* Section banner */}
          <div
            className="rounded-xl px-5 py-3.5 mb-4 flex items-center gap-3"
            style={{ background: "hsl(var(--primary))" }}
          >
            <span className="font-bold text-white text-base tracking-wide uppercase">
              {activePlatform?.label ?? activeCategory}
            </span>
            <span className="text-white/50 text-sm font-normal">— {filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="py-16 text-center rounded-xl bg-slate-50 dark:bg-white/2 border border-slate-200 dark:border-white/6">
              <p className="text-sm text-muted-foreground">No {activePlatform?.label} accounts in stock right now.</p>
            </div>
          ) : (
            <ProductGrid products={filteredProducts} onBuy={setBuyProduct} />
          )}
        </div>
      ) : (
        /* Grouped by category */
        grouped.length === 0 ? (
          <div className="py-16 text-center rounded-xl bg-slate-50 dark:bg-white/2 border border-slate-200 dark:border-white/6">
            <p className="text-sm text-muted-foreground">No products available yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ key, platform, items }) => (
              <div key={key}>
                {/* Section banner */}
                <div
                  className="rounded-xl px-5 py-3.5 mb-3 flex items-center gap-3"
                  style={{ background: "hsl(var(--primary))" }}
                >
                  <span className="font-bold text-white text-sm tracking-wide uppercase">
                    {platform?.label ?? key}
                  </span>
                </div>
                <ProductGrid products={items} onBuy={setBuyProduct} />
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Purchase modal ───────────────────────────────────────────────────── */}
      {buyProduct && <PurchaseModal product={buyProduct} onClose={() => setBuyProduct(null)} />}
    </div>
  );
}

// ─── Product grid & cards ─────────────────────────────────────────────────────

function ProductGrid({
  products,
  onBuy,
}: {
  products: Product[];
  onBuy: (p: Product) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {products.map((p) => <ProductCard key={p.id} product={p} onBuy={onBuy} />)}
    </div>
  );
}

function ProductCard({ product: p, onBuy }: { product: Product; onBuy: (p: Product) => void }) {
  const platform = PLATFORM_MAP[inferPlatformKey(p.title)];
  const stockLow = p.stock > 0 && p.stock <= 5;
  // Use darkColor override when in dark mode (prevents dark-on-dark invisible text)
  const isDark = document.documentElement.classList.contains("dark");
  const priceColor = (isDark && platform?.darkColor) ? platform.darkColor : (platform?.color ?? "hsl(var(--primary))");

  return (
    <div className="flex flex-col rounded-xl overflow-hidden bg-white dark:bg-white/3 border border-slate-200 dark:border-white/8 shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* Thin brand accent bar at top */}
      <div className="h-[3px] w-full" style={{ background: platform?.color ?? "#1877F2" }} />

      <div className="flex flex-col flex-1 p-4 gap-2">
        {/* Small logo (24px) + bold title — compact & clean */}
        <div className="flex items-center gap-2">
          <PlatformLogo product={p} platform={platform} size={24} />
          <h3 className="font-bold text-slate-900 dark:text-white text-sm leading-snug flex-1 min-w-0">
            {p.title}
          </h3>
        </div>

        {/* Stock line */}
        <p className="text-xs text-slate-900 dark:text-slate-300">
          {p.stock === 0 ? (
            <span className="text-red-500 font-semibold">Out of Stock</span>
          ) : stockLow ? (
            <>In Stock: <span className="font-semibold">{p.stock} qty.</span> — low!</>
          ) : (
            <>In Stock: <span className="font-semibold">{p.stock} qty.</span></>
          )}
        </p>

        {/* Price */}
        <p className="text-xs text-slate-900 dark:text-slate-300">
          Per Quantity:{" "}
          <span className="font-bold text-slate-900 dark:text-white">
            ₦{p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NGN
          </span>
        </p>

        {/* Divider — the 'cut' line the client requested */}
        <hr className="border-slate-200 dark:border-white/10" />

        {/* Purchase button */}
        <button
          onClick={() => onBuy(p)}
          disabled={p.stock === 0}
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-bold text-white transition-colors duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: p.stock === 0
              ? "#94a3b8"
              : (isDark ? "#047857" : "#334155"),
          }}
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
          {p.stock === 0 ? "Sold Out" : "Purchase"}
        </button>
      </div>
    </div>
  );
}
