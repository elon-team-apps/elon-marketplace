/**
 * Parses Edge Function `pocketfi-init` response after Paystack initialize.
 * Primary: Paystack `data.authorization_url`; includes aliases from the function.
 */
export function extractPaystackRedirectUrl(payload: Record<string, unknown>): string | undefined {
  const pick = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    return /^https?:\/\//i.test(s) ? s : undefined;
  };
  const nested = payload.data;
  if (nested && typeof nested === "object") {
    const d = nested as Record<string, unknown>;
    const fromData = pick(d.authorization_url);
    if (fromData) return fromData;
  }
  return (
    pick(payload.authorization_url) ??
    pick(payload.checkout_url) ??
    pick(payload.checkoutUrl)
  );
}
