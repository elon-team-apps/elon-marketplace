import { Headphones, MessageCircle, Send, Clock, ShieldCheck, Zap } from "lucide-react";

// ── Update this constant with your real Telegram handle ───────────────────────
const TELEGRAM_CHANNEL_URL = "https://t.me/Elonmarketplace99";
const TELEGRAM_SUPPORT_URL = "https://t.me/Elonmarketplace99";
// ─────────────────────────────────────────────────────────────────────────────

const CHANNELS = [
  {
    name: "Telegram Channel",
    handle: "@Elonmarketplace99",
    description: "Fastest response. Join our channel and our team replies within minutes.",
    url: TELEGRAM_CHANNEL_URL,
    icon: Send,
    gradient: "from-[#2AABEE]/20 to-[#229ED9]/10",
    border: "border-[#2AABEE]/25",
    iconBg: "bg-[#2AABEE]/15",
    iconColor: "text-[#2AABEE]",
    btnBg: "bg-[#2AABEE] hover:bg-[#2AABEE]/90",
    label: "Join Telegram Channel",
  },
  {
    name: "Telegram Support",
    handle: "@Elonmarketplace99",
    description: "Need help? Message us directly on Telegram and we'll get back to you shortly.",
    url: TELEGRAM_SUPPORT_URL,
    icon: Send,
    gradient: "from-[#229ED9]/20 to-[#1a7ab0]/10",
    border: "border-[#229ED9]/25",
    iconBg: "bg-[#229ED9]/15",
    iconColor: "text-[#229ED9]",
    btnBg: "bg-[#229ED9] hover:bg-[#229ED9]/90",
    label: "Message on Telegram",
  },
];

const FEATURES = [
  { icon: Zap,          title: "Instant Delivery",    body: "Accounts are delivered immediately after payment." },
  { icon: ShieldCheck,  title: "Verified Stock",       body: "Every account is tested before being listed." },
  { icon: Clock,        title: "24/7 Support",         body: "Our team is available around the clock to help." },
];

export default function SupportPage() {
  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold flex items-center gap-2.5">
          <Headphones className="h-6 w-6 text-accent" />
          Support
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Get help from our team — we're available 24/7
        </p>
      </div>

      {/* Hero card */}
      <div
        className="rounded-2xl border border-border p-6 text-center bg-card"
      >
        <div className="h-14 w-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
          <Headphones className="h-6 w-6 text-accent" />
        </div>
        <h2 className="font-heading font-bold text-lg text-foreground">How can we help?</h2>
        <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
          Contact us directly on Telegram. We handle delivery issues, wallet queries, and account support.
        </p>
      </div>

      {/* Contact channels */}
      <div className="grid sm:grid-cols-2 gap-4">
        {CHANNELS.map((ch) => {
          const Icon = ch.icon;
          return (
            <div
              key={ch.name}
              className={`rounded-2xl border ${ch.border} p-5 flex flex-col gap-4 bg-gradient-to-br ${ch.gradient}`}
              style={{ background: undefined }}
            >
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl ${ch.iconBg} flex items-center justify-center shrink-0`}>
                  <Icon className={`h-5 w-5 ${ch.iconColor}`} />
                </div>
                <div>
                  <p className="font-heading font-bold text-sm">{ch.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{ch.handle}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                {ch.description}
              </p>

              <a
                href={ch.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 ${ch.btnBg}`}
              >
                <Icon className="h-4 w-4" />
                {ch.label}
              </a>
            </div>
          );
        })}
      </div>

      {/* Feature bullets */}
      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="font-heading font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            What to expect
          </h2>
        </div>
        <div className="divide-y">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-start gap-4 px-6 py-4">
              <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center pb-2">
        Response times may vary. For urgent delivery issues, message us directly on Telegram @Elonmarketplace99.
      </p>
    </div>
  );
}
