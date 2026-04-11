import { useState, useEffect } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  ChevronDown,
  Upload,
  PackagePlus,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useApp, Product } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { resolveLogoUrlFromTitle } from "@/lib/logoResolver";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PostgrestError } from "@supabase/supabase-js";

const CATEGORIES = ["Social Media", "Streaming", "VPN"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function countLines(text: string) {
  return parseLines(text).length;
}

function formatPostgrestError(err: PostgrestError | null | undefined): string {
  if (!err) return "";
  return [err.message, err.details, err.hint, err.code ? `code: ${err.code}` : ""]
    .filter(Boolean)
    .join("\n");
}

function formatRpcFailure(
  error: PostgrestError | null,
  data: Record<string, unknown> | null | undefined,
): string {
  const parts: string[] = [];
  const pe = formatPostgrestError(error);
  if (pe) parts.push(pe);
  if (data && data.success === false && typeof data.message === "string") {
    parts.push(data.message);
  }
  if (data && typeof data.sqlstate === "string") {
    parts.push(`SQLSTATE ${data.sqlstate}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "Upload failed.";
}

/** Remove inventory rows before deleting a product (log_items after migration 009, else logs_data). */
async function deleteInventoryForProduct(productId: string) {
  if (!supabase) return { error: null as PostgrestError | null };
  const primary = await supabase.from("log_items").delete().eq("product_id", productId);
  if (!primary.error) return primary;
  const msg = primary.error.message ?? "";
  if (/log_items|schema cache|does not exist|not find/i.test(msg)) {
    return supabase.from("logs_data").delete().eq("product_id", productId);
  }
  return primary;
}

// ─── Product form state (Add Product only) ───────────────────────────────────

type FormState = {
  title: string;
  category: string;
  price: string;
  description: string;
  logsText: string;
  platform: string;
  login: string;
  password: string;
  recoveryInfo: string;
};

const emptyForm: FormState = {
  title: "",
  category: "Social Media",
  price: "",
  description: "",
  logsText: "",
  platform: "",
  login: "",
  password: "",
  recoveryInfo: "",
};

// ─── Bulk Upload Modal ─────────────────────────────────────────────────────────

type UploadStatus = "idle" | "uploading" | "success" | "error";

function BulkUploadModal({
  products,
  initialProductId,
  onClose,
  onSuccess,
}: {
  products: Product[];
  initialProductId: string | null;
  onClose: () => void;
  onSuccess: (productId: string, inserted: number) => void;
}) {
  const [selectedId, setSelectedId] = useState(() => initialProductId ?? products[0]?.id ?? "");
  const [logsText, setLogsText] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [result, setResult] = useState<{ inserted: number; newStock: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (initialProductId && products.some((p) => p.id === initialProductId)) {
      setSelectedId(initialProductId);
    } else if (products[0]?.id) {
      setSelectedId(products[0].id);
    }
  }, [initialProductId, products]);

  const lines = parseLines(logsText);
  const lineCount = lines.length;
  const selectedProduct = products.find((p) => p.id === selectedId);

  const handleUpload = async () => {
    if (!selectedId) {
      setErrorMsg("Please select a product.");
      setStatus("error");
      return;
    }
    if (lineCount === 0) {
      setErrorMsg("Paste at least one log line before uploading.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setErrorMsg("");
    setResult(null);

    if (supabase) {
      const { data, error } = await supabase.rpc("bulk_upload_logs", {
        p_product_id: selectedId,
        p_credentials: lines,
      });

      const payload = (data ?? undefined) as Record<string, unknown> | undefined;
      if (error || !payload?.success) {
        setErrorMsg(formatRpcFailure(error, payload));
        setStatus("error");
        return;
      }

      const inserted = Number(payload.inserted ?? 0);
      const newStock = Number(payload.new_stock ?? 0);
      setResult({ inserted, newStock });
      setStatus("success");
      onSuccess(selectedId, inserted);
      return;
    }

    onSuccess(selectedId, lineCount);
    setResult({
      inserted: lineCount,
      newStock: (selectedProduct?.stock_count ?? selectedProduct?.stock ?? 0) + lineCount,
    });
    setStatus("success");
  };

  const handleReset = () => {
    setLogsText("");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-xl bg-[hsl(var(--sidebar-background))] border border-sidebar-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0">
              <PackagePlus className="h-4.5 w-4.5 text-accent" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-sidebar-foreground">Bulk Log Upload</h2>
              <p className="text-xs text-sidebar-foreground/50 mt-0.5">
                Inserts into <span className="font-mono">log_items</span> for the selected product
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {status === "success" && result && (
            <div className="rounded-xl bg-accent/10 border border-accent/25 px-5 py-4 flex items-start gap-4">
              <CheckCircle2 className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-accent text-sm">Upload Successful</p>
                <p className="text-xs text-sidebar-foreground/60 mt-1">
                  <span className="font-bold text-sidebar-foreground">{result.inserted}</span> logs added to{" "}
                  <span className="font-bold text-sidebar-foreground">{selectedProduct?.title}</span>. New stock:{" "}
                  <span className="font-bold text-accent">{result.newStock}</span>.
                </p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="mt-3 text-xs font-semibold text-accent hover:underline"
                >
                  Upload more logs →
                </button>
              </div>
            </div>
          )}

          {status === "error" && errorMsg && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/25 px-5 py-4 flex items-start gap-4">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-destructive text-sm">Upload Failed</p>
                <pre className="text-xs text-sidebar-foreground/80 mt-2 whitespace-pre-wrap break-words font-mono">
                  {errorMsg}
                </pre>
              </div>
            </div>
          )}

          {status !== "success" && (
            <>
              <div>
                <Label className="text-sidebar-foreground/70 text-xs uppercase tracking-wider font-semibold">
                  Select Product
                </Label>
                <div className="relative mt-2">
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    disabled={status === "uploading"}
                    className="w-full h-11 rounded-xl border border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground px-4 pr-10 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
                  >
                    {products.length === 0 && <option value="">No products available</option>}
                    {products.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[hsl(222,60%,12%)]">
                        {p.title} — {p.category} ({p.stock_count ?? p.stock ?? 0} in stock)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/40 pointer-events-none" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sidebar-foreground/70 text-xs uppercase tracking-wider font-semibold">
                    Paste Logs (one per line)
                  </Label>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full transition-colors ${
                      lineCount > 0
                        ? "bg-accent/15 text-accent border border-accent/25"
                        : "bg-sidebar-accent/50 text-sidebar-foreground/40 border border-sidebar-border"
                    }`}
                  >
                    {lineCount === 0 ? "0 lines" : `${lineCount} log${lineCount === 1 ? "" : "s"} → Stock +${lineCount}`}
                  </span>
                </div>
                <textarea
                  rows={10}
                  disabled={status === "uploading"}
                  className="w-full rounded-xl border border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground/90 px-4 py-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 placeholder:text-sidebar-foreground/25"
                  placeholder={
                    "Paste credentials here, one account per line:\nuser@email.com:Password123:CookieTokenABC..."
                  }
                  value={logsText}
                  onChange={(e) => {
                    setLogsText(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                />
                <p className="text-xs text-sidebar-foreground/35 mt-2">
                  Each non-empty line becomes one row in <span className="font-mono">log_items</span> with the
                  selected <span className="font-mono">product_id</span>. Stock is recalculated by the server.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-sidebar-border flex items-center gap-3 shrink-0">
          {status !== "success" ? (
            <>
              <button
                type="button"
                onClick={handleUpload}
                disabled={status === "uploading" || lineCount === 0 || !selectedId}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
              >
                {status === "uploading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload {lineCount > 0 ? `${lineCount} Logs` : "Logs"}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "uploading"}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 disabled:opacity-40 transition-all duration-150"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-150"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Quick edit modal (title, price, description) ───────────────────────────

function EditProductModal({
  product,
  onClose,
  onSaved,
  patchProductLocal,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
  patchProductLocal: (id: string, updates: Partial<Omit<Product, "id" | "createdAt">>) => void;
}) {
  const [title, setTitle] = useState(product.title);
  const [price, setPrice] = useState(product.price.toString());
  const [description, setDescription] = useState(product.description);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setTitle(product.title);
    setPrice(product.price.toString());
    setDescription(product.description);
  }, [product.id, product.title, product.price, product.description]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const n = parseFloat(price);
    if (isNaN(n) || n <= 0) {
      toast({ title: "Valid price required", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (supabase) {
        const { error } = await supabase
          .from("products")
          .update({
            title: title.trim(),
            price: Math.trunc(n),
            description: description.trim(),
          })
          .eq("id", product.id);

        if (error) {
          toast({
            title: "Update failed",
            description: formatPostgrestError(error),
            variant: "destructive",
          });
          return;
        }
      } else {
        patchProductLocal(product.id, {
          title: title.trim(),
          price: Math.trunc(n),
          description: description.trim(),
        });
      }

      onSaved();
      toast({ title: "Product updated" });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md bg-[hsl(var(--sidebar-background))] border border-sidebar-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
          <h2 className="font-heading font-bold text-sidebar-foreground">Edit Product</h2>
          <button type="button" onClick={onClose} className="text-sidebar-foreground/40 hover:text-sidebar-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <Label className="text-sidebar-foreground/70 text-xs uppercase font-semibold">Name</Label>
            <Input
              className="mt-1.5 bg-sidebar-accent/30 border-sidebar-border"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <Label className="text-sidebar-foreground/70 text-xs uppercase font-semibold">Price (₦)</Label>
            <Input
              type="number"
              min={1}
              className="mt-1.5 bg-sidebar-accent/30 border-sidebar-border"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={saving}
            />
          </div>
          <div>
            <Label className="text-sidebar-foreground/70 text-xs uppercase font-semibold">Description</Label>
            <textarea
              rows={3}
              className="mt-1.5 w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-sm text-sidebar-foreground resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-sidebar-border flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminProducts() {
  const { products, addProduct, updateProduct, deleteProduct, refreshProducts } = useApp();
  const { toast } = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkUploadInitialId, setBulkUploadInitialId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const lineCount = countLines(form.logsText);

  const handleCancelAdd = () => {
    setForm(emptyForm);
    setShowAddForm(false);
  };

  const handleSubmitAdd = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    const price = parseFloat(form.price);
    if (isNaN(price) || price <= 0) {
      toast({ title: "Valid price required", variant: "destructive" });
      return;
    }
    const logs = parseLines(form.logsText);
    const autoLogoUrl = resolveLogoUrlFromTitle(form.title.trim());
    const stock = logs.length;

    if (supabase) {
      const { data: row, error: insErr } = await supabase
        .from("products")
        .insert({
          title: form.title.trim(),
          category: form.category,
          price: Math.trunc(price),
          description: form.description.trim(),
          stock,
          status: stock > 0 ? "available" : "sold_out",
        })
        .select("id")
        .maybeSingle();

      if (insErr) {
        toast({
          title: "Could not create product",
          description: formatPostgrestError(insErr),
          variant: "destructive",
        });
        return;
      }

      const newId = row?.id as string | undefined;
      if (newId && logs.length > 0) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("bulk_upload_logs", {
          p_product_id: newId,
          p_credentials: logs,
        });
        const payload = rpcData as Record<string, unknown> | null | undefined;
        if (rpcErr || !payload?.success) {
          toast({
            title: "Product created but log upload failed",
            description: formatRpcFailure(rpcErr, payload),
            variant: "destructive",
          });
          await refreshProducts();
          handleCancelAdd();
          return;
        }
      }

      await refreshProducts();
      toast({ title: "Product added", description: stock > 0 ? `${stock} logs uploaded.` : "No logs yet." });
      handleCancelAdd();
      return;
    }

    addProduct({
      title: form.title.trim(),
      category: form.category,
      price,
      description: form.description.trim(),
      logs,
      stock_count: stock,
      stock,
      logo_url: autoLogoUrl,
    });
    toast({ title: "Product added", description: `${stock} logs in inventory.` });
    handleCancelAdd();
  };

  const addAccountLine = () => {
    if (!form.platform.trim() || !form.login.trim() || !form.password.trim()) {
      toast({ title: "Platform, login, and password are required.", variant: "destructive" });
      return;
    }
    const entry = [
      `Platform=${form.platform.trim()}`,
      `Login=${form.login.trim()}`,
      `Password=${form.password.trim()}`,
      `Recovery=${form.recoveryInfo.trim() || "N/A"}`,
    ].join(" | ");
    setForm((f) => ({
      ...f,
      logsText: f.logsText ? `${f.logsText}\n${entry}` : entry,
      login: "",
      password: "",
      recoveryInfo: "",
    }));
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleting(true);
    try {
      if (supabase) {
        const invDel = await deleteInventoryForProduct(id);
        if (invDel.error) {
          toast({
            title: "Could not delete inventory",
            description: formatPostgrestError(invDel.error),
            variant: "destructive",
          });
          return;
        }

        const { error: prodErr } = await supabase.from("products").delete().eq("id", id);
        if (prodErr) {
          toast({
            title: "Could not delete product",
            description: formatPostgrestError(prodErr),
            variant: "destructive",
          });
          return;
        }

        await refreshProducts();
      } else {
        deleteProduct(id);
      }

      toast({ title: "Product deleted", description: `"${deleteTarget.title}" and its logs were removed.` });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkSuccess = async (_productId: string, inserted: number) => {
    await refreshProducts();
    toast({
      title: "Bulk upload complete",
      description: `${inserted} log row(s) inserted.`,
    });
  };

  const handleEditSaved = async () => {
    await refreshProducts();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Product Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Add, edit, and manage products with log inventory</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setBulkUploadInitialId(null);
              setShowBulkUpload(true);
            }}
            variant="outline"
            className="gap-2 border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50"
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </Button>
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Product
            </Button>
          )}
        </div>
      </div>

      {showAddForm && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-heading font-semibold text-lg">New Product</h2>
            <button type="button" onClick={handleCancelAdd} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <Label htmlFor="prod-title">Product Title</Label>
              <Input
                id="prod-title"
                className="mt-1.5"
                placeholder="e.g. PURE Random Country FACEBOOK | 2007–2024"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="prod-category">Category</Label>
              <div className="relative mt-1.5">
                <select
                  id="prod-category"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 pr-8 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div>
              <Label htmlFor="prod-price">Price (₦)</Label>
              <Input
                id="prod-price"
                type="number"
                min={1}
                className="mt-1.5"
                placeholder="e.g. 1500"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="prod-desc">Description</Label>
              <textarea
                id="prod-desc"
                rows={2}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Brief description shown to users..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor="prod-logs">
                  <span className="flex items-center gap-2">
                    <Upload className="h-3.5 w-3.5" />
                    Initial Account Upload
                  </span>
                </Label>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    lineCount > 0 ? "bg-accent/15 text-accent" : "bg-white/8 text-slate-400"
                  }`}
                >
                  {lineCount} {lineCount === 1 ? "log" : "logs"} → Stock: {lineCount}
                </span>
              </div>
              <textarea
                id="prod-logs"
                rows={8}
                className="w-full rounded-md border border-input bg-white/3 px-3 py-2.5 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={
                  "Paste account logs here, one per line:\nPlatform=Instagram | Login=user@email.com | Password=Secret123 | Recovery=backup@mail.com"
                }
                value={form.logsText}
                onChange={(e) => setForm((f) => ({ ...f, logsText: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                You can add more logs later with Bulk Upload. Initial lines are stored in{" "}
                <span className="font-mono">log_items</span> when using Supabase.
              </p>
            </div>
            <div className="md:col-span-2 grid md:grid-cols-2 gap-3 rounded-lg border border-input p-3">
              <div>
                <Label htmlFor="acc-platform">Platform</Label>
                <Input
                  id="acc-platform"
                  className="mt-1.5"
                  value={form.platform}
                  onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
                  placeholder="e.g. Facebook"
                />
              </div>
              <div>
                <Label htmlFor="acc-login">Login (Email/Username)</Label>
                <Input
                  id="acc-login"
                  className="mt-1.5"
                  value={form.login}
                  onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
                  placeholder="e.g. user@example.com"
                />
              </div>
              <div>
                <Label htmlFor="acc-password">Password</Label>
                <Input
                  id="acc-password"
                  className="mt-1.5"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="e.g. StrongPass123!"
                />
              </div>
              <div>
                <Label htmlFor="acc-recovery">Recovery Info</Label>
                <Input
                  id="acc-recovery"
                  className="mt-1.5"
                  value={form.recoveryInfo}
                  onChange={(e) => setForm((f) => ({ ...f, recoveryInfo: e.target.value }))}
                  placeholder="backup email / recovery note"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="button" variant="outline" className="mt-1.5" onClick={addAccountLine}>
                  Add Account Log Line
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6 pt-5 border-t">
            <Button onClick={handleSubmitAdd} className="gap-2">
              <Save className="h-4 w-4" />
              Create Product
            </Button>
            <Button variant="ghost" onClick={handleCancelAdd}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-heading font-semibold">
            Inventory ({products.length} {products.length === 1 ? "product" : "products"})
          </h2>
        </div>
        {products.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            No products yet. Click &quot;Add Product&quot; to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-white/3">
                  <th className="px-5 py-3.5 text-left font-semibold text-muted-foreground">Product</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Cat.</th>
                  <th className="px-5 py-3.5 text-right font-semibold text-muted-foreground">Price</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Stock</th>
                  <th className="px-5 py-3.5 text-center font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-4 max-w-[280px]">
                      <p className="font-medium truncate">{product.title}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{product.description}</p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-info/10 text-info text-xs font-bold">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-accent">
                      ₦{product.price.toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          (product.stock_count ?? product.stock ?? 0) > 5
                            ? "bg-accent/15 text-accent"
                            : (product.stock_count ?? product.stock ?? 0) > 0
                              ? "bg-warning/15 text-warning"
                              : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {product.stock_count ?? product.stock ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Bulk upload logs for this product"
                          onClick={() => {
                            setBulkUploadInitialId(product.id);
                            setShowBulkUpload(true);
                          }}
                          className="h-7 px-2 text-xs text-accent hover:text-accent hover:bg-accent/10"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit name, price, description"
                          onClick={() => setEditTarget(product)}
                          className="h-7 px-2 text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete product"
                          onClick={() => setDeleteTarget(product)}
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product and all its logs? This cannot be undone.
              {deleteTarget && (
                <span className="block mt-2 font-medium text-foreground">&quot;{deleteTarget.title}&quot;</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {showBulkUpload && (
        <BulkUploadModal
          products={products}
          initialProductId={bulkUploadInitialId}
          onClose={() => {
            setShowBulkUpload(false);
            setBulkUploadInitialId(null);
          }}
          onSuccess={handleBulkSuccess}
        />
      )}

      {editTarget && (
        <EditProductModal
          product={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleEditSaved}
          patchProductLocal={updateProduct}
        />
      )}
    </div>
  );
}
