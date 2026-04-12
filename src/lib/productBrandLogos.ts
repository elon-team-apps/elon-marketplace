/**
 * Global keyword → brand image (SimpleIcons CDN) or built-in visual kinds.
 * Checks **title and category** so e.g. "Netflix" in either field resolves correctly.
 *
 * Storefront priorities include: **Netflix, VPN** (word or VPN category), **WhatsApp**,
 * **Twitter / X**, **Telegram**, **Facebook**, plus other common brands (Instagram, TikTok, …).
 */

export type BrandVisual =
  | { kind: "image"; src: string; alt: string }
  | { kind: "vpn" }
  | { kind: "box" };

const NETFLIX = "https://cdn.simpleicons.org/netflix/e50914";
const WHATSAPP = "https://cdn.simpleicons.org/whatsapp/25d366";
const X = "https://cdn.simpleicons.org/x/000000";
const NORD = "https://cdn.simpleicons.org/nordvpn/0055ff";
const EXPRESS = "https://cdn.simpleicons.org/expressvpn/ff122d";
const HMA = "https://cdn.simpleicons.org/hidemyass/ffcc00";
const FB = "https://cdn.simpleicons.org/facebook/1877f2";
const IG = "https://cdn.simpleicons.org/instagram/e4405f";
const TIKTOK = "https://cdn.simpleicons.org/tiktok/000000";
const TELEGRAM = "https://cdn.simpleicons.org/telegram/26a69a";
const YOUTUBE = "https://cdn.simpleicons.org/youtube/ff0000";
const LINKEDIN = "https://cdn.simpleicons.org/linkedin/0a66c2";

type Rule = { test: RegExp; visual: BrandVisual };

const RULES: Rule[] = [
  { test: /netflix/i, visual: { kind: "image", src: NETFLIX, alt: "Netflix" } },
  { test: /whatsapp/i, visual: { kind: "image", src: WHATSAPP, alt: "WhatsApp" } },
  { test: /\b(nord|nordvpn)\b/i, visual: { kind: "image", src: NORD, alt: "NordVPN" } },
  { test: /express|expressvpn/i, visual: { kind: "image", src: EXPRESS, alt: "ExpressVPN" } },
  { test: /\b(hma|hidemyass)\b/i, visual: { kind: "image", src: HMA, alt: "HMA" } },
  { test: /twitter|\bx\b|\sx\s|^x\s/i, visual: { kind: "image", src: X, alt: "X" } },
  { test: /\bfb[\s._-]*dating\b|fbdating/i, visual: { kind: "image", src: FB, alt: "Facebook" } },
  { test: /facebook/i, visual: { kind: "image", src: FB, alt: "Facebook" } },
  { test: /\big\b|\binstagram\b/i, visual: { kind: "image", src: IG, alt: "Instagram" } },
  { test: /tiktok/i, visual: { kind: "image", src: TIKTOK, alt: "TikTok" } },
  { test: /telegram/i, visual: { kind: "image", src: TELEGRAM, alt: "Telegram" } },
  { test: /youtube|yt premium/i, visual: { kind: "image", src: YOUTUBE, alt: "YouTube" } },
  { test: /linkedin/i, visual: { kind: "image", src: LINKEDIN, alt: "LinkedIn" } },
  { test: /talkatone/i, visual: { kind: "image", src: "https://cdn.simpleicons.org/viber/7360f2", alt: "Talkatone" } },
  { test: /surfshark|cyberghost|protonvpn|mullvad|windscribe|private internet access|purevpn|ipvanish/i, visual: { kind: "vpn" } },
];

function matchesRule(text: string, rule: Rule): boolean {
  return rule.test.test(text);
}

/**
 * Pick logo/mark for UI. Order: keyword match on title+category → stored logo_url → generic box.
 * VPN *category* or plain "vpn" in text yields shield icon (not a specific brand).
 */
export function resolveProductBrandVisual(product: {
  title: string;
  category?: string | null;
  logo_url?: string | null;
}): BrandVisual {
  const title = (product.title || "").trim();
  const category = (product.category || "").trim();
  const haystack = `${title}\n${category}`;

  for (const rule of RULES) {
    if (matchesRule(haystack, rule)) return rule.visual;
  }

  const catLower = category.toLowerCase();
  if (catLower === "vpn" || /\bvpn\b/i.test(haystack)) {
    return { kind: "vpn" };
  }

  const stored = (product.logo_url || "").trim();
  if (stored) return { kind: "image", src: stored, alt: title || "Product" };

  return { kind: "box" };
}

/** URL for DB `logo_url` when you only want a string (Paystack / legacy paths). */
export function resolveLogoUrlFromKeywords(title: string, category = ""): string | undefined {
  const v = resolveProductBrandVisual({ title, category, logo_url: "" });
  return v.kind === "image" ? v.src : undefined;
}
