const SMART_LOGOS: Array<{ test: RegExp; logoUrl: string }> = [
  {
    test: /netflix/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/512px-Netflix_2015_logo.svg.png?v=3",
  },
  {
    test: /\b(hma|hidemyass)\b/i,
    logoUrl: "https://www.hidemyass.com/en-us/index/assets/img/hma-logo-color.png?v=3",
  },
  {
    test: /nord|nordvpn/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/NordVPN_Logo.svg/512px-NordVPN_Logo.svg.png?v=3",
  },
  {
    test: /talkatone/i,
    logoUrl: "https://static.wikia.nocookie.net/logopedia/images/4/40/Talkatone_2017.png?v=3",
  },
  {
    test: /facebook/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Facebook_icon.svg/512px-2021_Facebook_icon.svg.png?v=3",
  },
  {
    test: /instagram/i,
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Instagram_logo_2016.svg/512px-Instagram_logo_2016.svg.png?v=3",
  },
];

export function resolveLogoUrlFromTitle(title: string): string | undefined {
  const normalized = (title || "").trim();
  if (!normalized) return undefined;
  return SMART_LOGOS.find((entry) => entry.test.test(normalized))?.logoUrl;
}
