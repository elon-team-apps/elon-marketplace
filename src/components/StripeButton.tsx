import { useState } from "react";

type StripeButtonProps = {
  productId: string;
  quantity: number;
  customerEmail: string;
  className?: string;
};

export function StripeButton({
  productId,
  quantity,
  customerEmail,
  className,
}: StripeButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleDraftStripeCheckout = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/checkout/stripe/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity, customerEmail }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      const message = payload.message || payload.error || "Stripe checkout draft endpoint called.";
      window.alert(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe draft call failed.";
      window.alert(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleDraftStripeCheckout()}
      disabled={loading}
      className={
        className ??
        "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      }
    >
      {loading ? "Preparing Stripe..." : "Pay with Stripe (Draft)"}
    </button>
  );
}
