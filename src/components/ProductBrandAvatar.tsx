import { useState, useEffect } from "react";
import { Shield, Package } from "lucide-react";
import { resolveProductBrandVisual } from "@/lib/productBrandLogos";

const FALLBACK_STROKE = "#64748b";

type Props = {
  title: string;
  category?: string | null;
  logo_url?: string | null;
  size?: number;
  /** Border tint (e.g. platform accent) */
  accentColor?: string;
  className?: string;
};

/** Storefront + admin: keyword-aware brand mark with VPN shield / box fallbacks. */
export function ProductBrandAvatar({
  title,
  category,
  logo_url,
  size = 36,
  accentColor = "#ccc",
  className = "",
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const dim = `${size}px`;
  const visual = resolveProductBrandVisual({ title, category, logo_url });

  useEffect(() => {
    setImgFailed(false);
  }, [title, category, logo_url]);

  return (
    <div
      className={`rounded-lg overflow-hidden flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: dim,
        height: dim,
        background: "#f8f9fa",
        border: `1px solid ${accentColor}30`,
        padding: 3,
      }}
    >
      {visual.kind === "image" && !imgFailed ? (
        <img
          src={visual.src}
          alt={visual.alt}
          className="w-full h-full object-contain"
          onError={() => setImgFailed(true)}
        />
      ) : visual.kind === "vpn" ? (
        <div className="w-full h-full flex items-center justify-center text-indigo-600" aria-hidden>
          <Shield className="w-[62%] h-[62%] min-w-[14px] min-h-[14px]" strokeWidth={2} />
        </div>
      ) : (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ color: FALLBACK_STROKE }}
          aria-hidden
          title="Digital product"
        >
          <Package className="w-[55%] h-[55%] min-w-[14px] min-h-[14px]" strokeWidth={2} />
        </div>
      )}
    </div>
  );
}
