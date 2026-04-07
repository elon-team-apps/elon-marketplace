import { useEffect, useMemo, useState } from "react";
import { Search, Wallet, ShoppingCart, ShieldCheck, Smartphone, RefreshCw, Package } from "lucide-react";
import { toast } from "sonner";
import { useApp, Product } from "@/context/AppContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { checkSMS, buyNumber } from "@/lib/fivesim";

function ProductCard({ product, onPurchase }: { product: Product; onPurchase: (id: string) => Promise<void> }) {
  return (
    <div className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{product.title}</h3>
        <span className="rounded-md bg-black px-2 py-1 text-[10px] text-yellow-400">{product.category}</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">Stock: {product.stock}</p>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-yellow-400">N{product.price.toLocaleString()}</p>
        <Button
          disabled={product.stock < 1}
          onClick={() => onPurchase(product.id)}
          className="h-8 bg-yellow-500 text-black hover:bg-yellow-400"
        >
          Buy
        </Button>
      </div>
    </div>
  );
}

export default function EngineRoomPage() {
  const { currentUser, products, purchaseProduct, orders } = useApp();
  const [query, setQuery] = useState("");
  const [isLoadingGrid, setIsLoadingGrid] = useState(true);
  const [country, setCountry] = useState("usa");
  const [operator, setOperator] = useState("any");
  const [service, setService] = useState("google");
  const [activationId, setActivationId] = useState("");
  const [smsResult, setSmsResult] = useState<string>("");

  const myOrders = useMemo(
    () => orders.filter((o) => o.userId === currentUser.id).slice(0, 8),
    [orders, currentUser.id]
  );

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => `${p.title} ${p.category}`.toLowerCase().includes(q));
  }, [products, query]);

  useEffect(() => {
    const t = window.setTimeout(() => setIsLoadingGrid(false), 500);
    return () => window.clearTimeout(t);
  }, []);

  const handlePurchase = async (productId: string) => {
    const result = await purchaseProduct(productId);
    if (result.success) {
      toast.success("Purchase completed", { description: "Credentials are now available in Orders." });
    } else {
      toast.error("Purchase failed", { description: result.message });
    }
  };

  const handleBuyNumber = async () => {
    try {
      const data = await buyNumber(country, operator, service);
      toast.success("5SIM number purchased", { description: `Order #${data.id} - ${data.phone}` });
      setActivationId(String(data.id));
    } catch (error) {
      toast.error("5SIM purchase failed", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  };

  const handleCheckSms = async () => {
    try {
      const id = Number(activationId);
      if (!id) {
        toast.error("Enter a valid activation ID");
        return;
      }
      const data = await checkSMS(id);
      const latest = data.sms?.[0];
      setSmsResult(latest?.code || latest?.text || "No SMS yet");
      toast.success("SMS check complete", { description: `Status: ${data.status}` });
    } catch (error) {
      toast.error("SMS check failed", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  };

  return (
    <div className="space-y-5 bg-black text-white">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4 md:col-span-2">
          <p className="mb-2 text-xs uppercase tracking-widest text-yellow-400">Engine Room</p>
          <h1 className="text-xl font-bold">Operations Dashboard</h1>
          <p className="mt-2 text-sm text-slate-400">Private control center for purchases, wallet, and activations.</p>
        </div>
        <div className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4">
          <div className="mb-2 flex items-center gap-2 text-slate-300"><Wallet className="h-4 w-4 text-yellow-400" /> Wallet</div>
          <p className="text-xl font-bold text-yellow-400">N{(currentUser.wallet_balance ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4">
          <div className="mb-2 flex items-center gap-2 text-slate-300"><Package className="h-4 w-4 text-yellow-400" /> Orders</div>
          <p className="text-xl font-bold text-yellow-400">{myOrders.length}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><ShoppingCart className="h-4 w-4 text-yellow-400" /> App Grid</h2>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Instant search products..." className="border-yellow-500/20 bg-black pl-8 text-white" />
            </div>
          </div>
          {isLoadingGrid ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl bg-slate-800" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredProducts.map((product) => <ProductCard key={product.id} product={product} onPurchase={handlePurchase} />)}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Smartphone className="h-4 w-4 text-yellow-400" /> 5SIM Search</h2>
          <div className="space-y-2">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} className="border-yellow-500/20 bg-black text-white" placeholder="Country (e.g. usa)" />
            <Input value={operator} onChange={(e) => setOperator(e.target.value)} className="border-yellow-500/20 bg-black text-white" placeholder="Operator (e.g. any)" />
            <Input value={service} onChange={(e) => setService(e.target.value)} className="border-yellow-500/20 bg-black text-white" placeholder="Service (e.g. google)" />
            <Button onClick={handleBuyNumber} className="w-full bg-yellow-500 text-black hover:bg-yellow-400">Buy Number</Button>
            <Input value={activationId} onChange={(e) => setActivationId(e.target.value)} className="border-yellow-500/20 bg-black text-white" placeholder="Activation ID" />
            <Button onClick={handleCheckSms} variant="outline" className="w-full border-yellow-500/30 bg-black text-yellow-400">
              <RefreshCw className="mr-2 h-4 w-4" /> Check SMS
            </Button>
            {smsResult && <p className="rounded-lg border border-yellow-500/20 bg-black p-2 text-xs text-slate-300">{smsResult}</p>}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-yellow-500/20 bg-slate-900 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><ShieldCheck className="h-4 w-4 text-yellow-400" /> Order Display</h2>
        <div className="space-y-2">
          {myOrders.length === 0 ? (
            <p className="text-sm text-slate-400">No orders yet.</p>
          ) : (
            myOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-xl border border-yellow-500/10 bg-black p-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">{order.productTitle}</p>
                  <p className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <p className="text-sm font-semibold text-yellow-400">N{order.amount.toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
