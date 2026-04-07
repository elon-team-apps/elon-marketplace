const SMART_LOGOS: Array<{ test: RegExp; logoUrl: string }> = [
  {
    test: /netflix/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/512px-Netflix_2015_logo.svg.png",
  },
  {
    test: /\b(hma|hidemyass)\b/i,
    logoUrl: "https://www.hidemyass.com/en-us/index/assets/img/hma-logo-color.svg",
  },
  {
    test: /nord|nordvpn/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f9/NordVPN_Logo.png",
  },
  {
    test: /express|expressvpn/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7a/ExpressVPN_logo.png",
  },
  {
    test: /talkatone/i,
    logoUrl: "https://static.wikia.nocookie.net/logopedia/images/4/40/Talkatone_2017.png",
  },
  {
    test: /\bfb[\s._-]*dating\b/i,
    logoUrl: "https://cdn.simpleicons.org/facebook/1877f2",
  },
  {
    test: /facebook/i,
    logoUrl: "https://cdn.simpleicons.org/facebook/1877f2",
  },
  {
    test: /instagram/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Instagram_logo_2016.svg/512px-Instagram_logo_2016.svg.png",
  },
];

export function resolveLogoUrlFromTitle(title: string): string | undefined {
  const normalized = (title || "").trim();
  if (!normalized) return undefined;
  return SMART_LOGOS.find((entry) => entry.test.test(normalized))?.logoUrl;
}
