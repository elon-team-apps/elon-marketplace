/** Single source of truth for product category labels (admin + storefront normalization). */
export const PRODUCT_CATEGORIES = [
  "Social Media",
  "Streaming",
  "Netflix",
  "VPN",
  "Messaging",
  "Gaming",
  "Other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = "Social Media";
