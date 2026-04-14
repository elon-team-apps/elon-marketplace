import type { Product } from "@/context/AppContext";

type StockOptions = {
  /** Optional authoritative live log count from DB/realtime subscriptions. */
  liveLogCount?: number | null;
};

/**
 * Canonical stock calculator used across UI:
 * total stock = live logs + manual_stock fallback.
 */
export function calculateStock(product: Product, options?: StockOptions): number {
  const liveFromOption =
    options && typeof options.liveLogCount === "number" && Number.isFinite(options.liveLogCount)
      ? Math.max(0, Math.trunc(options.liveLogCount))
      : null;

  const logsLength = Array.isArray(product.logs) ? product.logs.length : 0;
  const liveFromProduct = logsLength > 0
    ? Math.max(0, Math.trunc(logsLength))
    : Number.isFinite(Number(product.stock_count))
      ? Math.max(0, Math.trunc(Number(product.stock_count ?? 0)))
      : Number.isFinite(Number(product.stock))
        ? Math.max(0, Math.trunc(Number(product.stock ?? 0)))
        : 0;

  const manual = Math.max(0, Math.trunc(Number(product.manual_stock ?? 0)));
  const live = liveFromOption ?? liveFromProduct;

  return live + manual;
}

export function calculateStockBreakdown(product: Product, options?: StockOptions) {
  const liveFromOption =
    options && typeof options.liveLogCount === "number" && Number.isFinite(options.liveLogCount)
      ? Math.max(0, Math.trunc(options.liveLogCount))
      : null;
  const logsLength = Array.isArray(product.logs) ? product.logs.length : 0;
  const liveFromProduct = logsLength > 0
    ? Math.max(0, Math.trunc(logsLength))
    : Number.isFinite(Number(product.stock_count))
      ? Math.max(0, Math.trunc(Number(product.stock_count ?? 0)))
      : Number.isFinite(Number(product.stock))
        ? Math.max(0, Math.trunc(Number(product.stock ?? 0)))
        : 0;
  const live = liveFromOption ?? liveFromProduct;
  const manual = Math.max(0, Math.trunc(Number(product.manual_stock ?? 0)));
  return {
    live,
    manual,
    total: live + manual,
    isManualOnly: live === 0 && manual > 0,
  };
}
