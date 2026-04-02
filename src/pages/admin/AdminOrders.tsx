import { useState } from "react";
import { Search, Eye, X } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminOrders() {
  const { orders } = useApp();
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);

  const filtered = orders.filter(
    (o) =>
      o.userName.toLowerCase().includes(search.toLowerCase()) ||
      o.productTitle.toLowerCase().includes(search.toLowerCase()) ||
      o.category.toLowerCase().includes(search.toLowerCase())
  );

  const viewingOrder = orders.find((o) => o.id === viewing);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">Order Audit</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Master list of all purchases — {orders.length} total
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by user, product, category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-white/4">
                <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">Order ID</th>
                <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">User</th>
                <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">Product</th>
                <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Cat.</th>
                <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Amount</th>
                <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Date</th>
                <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Log</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-white/3 transition-colors">
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                    {order.id.slice(-8)}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                        {order.userName.charAt(0)}
                      </div>
                      <span className="font-medium">{order.userName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 max-w-[200px]">
                    <p className="truncate text-muted-foreground">{order.productTitle}</p>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-info/10 text-info text-xs font-bold">
                      {order.category}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-bold text-accent">
                    ₦{order.amount.toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-center text-muted-foreground text-xs">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewing(order.id)}
                      className="h-7 px-2 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">No orders found.</div>
          )}
        </div>
      </div>

      {/* Log viewer modal */}
      {viewingOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => setViewing(null)}
        >
          <div
            className="glass-card w-full max-w-md p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setViewing(null)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="font-heading font-semibold mb-1">Delivered Log</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Order {viewingOrder.id.slice(-8)} · {viewingOrder.userName}
            </p>
            <div className="rounded-lg p-4 font-mono text-xs break-all">
              {viewingOrder.deliveredLog}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg p-3">
                <p className="text-muted-foreground mb-0.5">Product</p>
                <p className="font-medium truncate">{viewingOrder.productTitle}</p>
              </div>
              <div className="rounded-lg p-3">
                <p className="text-muted-foreground mb-0.5">Amount Paid</p>
                <p className="font-bold text-accent">₦{viewingOrder.amount.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
