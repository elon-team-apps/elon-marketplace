import { resolveLogoUrlFromKeywords } from "@/lib/productBrandLogos";

/** Persisted `products.logo_url` — uses title + optional category for keyword match. */
export function resolveLogoUrlFromTitle(title: string, category?: string): string | undefined {
  return resolveLogoUrlFromKeywords(title, category ?? "");
}
