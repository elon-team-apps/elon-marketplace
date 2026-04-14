import { useState, useEffect, useCallback } from "react";
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
  List,
} from "lucide-react";
import { useApp, Product } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { resolveLogoUrlFromTitle } from "@/lib/logoResolver";
import { ProductBrandAvatar } from "@/components/ProductBrandAvatar";
import { DEFAULT_PRODUCT_CATEGORY, PRODUCT_CATEGORIES } from "@/constants/productCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
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
import { formatSupabasePostgrestError } from "@/lib/supabaseErrors";
import { parseLogLines, validatePastedLogs } from "@/lib/logParser";
import { rpcBulkUploadLogs } from "@/lib/bulkUploadLogs";

const BTN_NAVY = "#0f172a";
const BTN_DELETE = "#dc2626";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LogRow = {
  id: string;
  credentials: string;
  is_delivered: boolean;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensures the shared anon client has a JWT so RLS and SECURITY DEFINER RPCs see `auth.uid()`. */
async function requireSupabaseUserSession(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  if (!supabase) return { ok: false, message: "Supabase is not configured." };
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return {
      ok: false,
      message: `message: ${error.message}${error.name ? `\nname: ${error.name}` : ""}`,
    };
  }
  if (!data.session?.access_token) {
    return {
      ok: false,
      message: "No active session. Sign in again, then retry this action.",
    };
  }
  return { ok: true };
}

function isIgnorableInventoryDeleteError(err: PostgrestError | null): boolean {
  if (!err) return true;
  return /does not exist|not find|schema cache|PGRST205|Could not find the table/i.test(err.message ?? "");
}

/** Remove all inventory rows for this product (both table names) before deleting the product row — avoids FK issues. */
async function deleteInventoryForProduct(productId: string): Promise<{ error: PostgrestError | null }> {
  if (!supabase) return { error: null };

  const logItemsRes = await supabase.from("log_items").delete().eq("product_id", productId);
  const logsDataRes = await supabase.from("logs_data").delete().eq("product_id", productId);

  if (isIgnorableInventoryDeleteError(logItemsRes.error) && isIgnorableInventoryDeleteError(logsDataRes.error)) {
    return { error: null };
  }
  if (!isIgnorableInventoryDeleteError(logItemsRes.error)) return { error: logItemsRes.error };
  if (!isIgnorableInventoryDeleteError(logsDataRes.error)) return { error: logsDataRes.error };
  return { error: null };
}

/** Recompute products.stock from log_items with status = 'available' (schema 015+). */
async function syncProductStockFromLogs(productId: string): Promise<number> {
  if (!supabase) return 0;
  let count = 0;
  const a = await supabase
    .from("log_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .eq("status", "available");
  if (!a.error && typeof a.count === "number") {
    count = a.count;
  } else {
    const b = await supabase
      .from("log_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("is_delivered", false);
    if (!b.error && typeof b.count === "number") count = b.count;
  }
  await supabase
    .from("products")
    .update({
      stock: count,
      status: count > 0 ? "available" : "sold_out",
    })
    .eq("id", productId);
  return count;
}

/** Live stock = count of log_items per product where status = 'available' (not products.stock). */
async function fetchLiveStockByProductIds(productIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!supabase || productIds.length === 0) return counts;

  const primary = await supabase
    .from("log_items")
    .select("product_id")
    .in("product_id", productIds)
    .eq("status", "available");

  if (!primary.error && primary.data) {
    for (const row of primary.data as Array<{ product_id?: string }>) {
      const pid = String(row.product_id ?? "");
      if (!pid) continue;
      counts[pid] = (counts[pid] ?? 0) + 1;
    }
    return counts;
  }

  const legacy = await supabase
    .from("log_items")
    .select("product_id")
    .in("product_id", productIds)
    .eq("is_delivered", false);
  if (!legacy.error && legacy.data) {
    for (const row of legacy.data as Array<{ product_id?: string }>) {
      const pid = String(row.product_id ?? "");
      if (!pid) continue;
      counts[pid] = (counts[pid] ?? 0) + 1;
    }
  }
  return counts;
}

// ─── Bulk Upload Modal ─────────────────────────────────────────────────────────

type UploadStatus = "idle" | "uploading" | "success" | "error";

function BulkUploadModal({
  products,
  liveStockById,
  initialProductId,
  onClose,
  onSuccess,
}: {
  products: Product[];
  /** Live counts from log_items.status = 'available' (admin page); falls back to product row. */
  liveStockById: Record<string, number>;
  initialProductId: string | null;
  onClose: () => void;
  onSuccess: (productId: string, inserted: number, newStock: number) => void | Promise<void>;
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

  const pasteValidation = validatePastedLogs(logsText);
  const lineCount = pasteValidation.ok ? pasteValidation.entries.length : parseLogLines(logsText).length;
  const skippedCount = pasteValidation.ok ? pasteValidation.skipped : 0;
  const selectedProduct = products.find((p) => p.id === selectedId);

  const handleUpload = async () => {
    if (!selectedId) {
      setErrorMsg("Please select a product.");
      setStatus("error");
      return;
    }
    const validated = validatePastedLogs(logsText);
    if (!validated.ok) {
      setErrorMsg(validated.message);
      setStatus("error");
      return;
    }
    const entries = validated.entries;
    if (entries.length === 0) {
      setErrorMsg("Paste at least one non-empty line.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setErrorMsg("");
    setResult(null);

    if (supabase) {
      const sess = await requireSupabaseUserSession();
      if (!sess.ok) {
        setErrorMsg(sess.message);
        setStatus("error");
        return;
      }
      const rpcRes = await rpcBulkUploadLogs(selectedId, entries);
      if (!rpcRes.ok) {
        console.error("[bulk_upload_logs] failed", {
          productId: selectedId,
          lineCount: entries.length,
          error: rpcRes.error,
          payload: rpcRes.payload,
        });
        setErrorMsg(rpcRes.details);
        setStatus("error");
        return;
      }

      const inserted = rpcRes.inserted;
      const newStock = rpcRes.newStock;
      setResult({ inserted, newStock });
      setStatus("success");
      sonnerToast.success("Upload complete", {
        description: `${inserted} log line(s) added · Stock now ${newStock}`,
      });
      await Promise.resolve(onSuccess(selectedId, inserted, newStock));
      return;
    }

    const prevStock = selectedProduct?.stock_count ?? selectedProduct?.stock ?? 0;
    const newStockOffline = prevStock + entries.length;
    await Promise.resolve(onSuccess(selectedId, entries.length, newStockOffline));
    setResult({
      inserted: entries.length,
      newStock: newStockOffline,
    });
    setStatus("success");
    sonnerToast.success("Upload complete", { description: `${entries.length} line(s) recorded (offline).` });
  };

  const handleReset = () => {
    setLogsText("");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ background: BTN_NAVY }}
            >
              <PackagePlus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-slate-900 dark:text-white">Bulk log upload</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                One account per line · <span className="font-semibold text-slate-600 dark:text-slate-300">email</span>
                {" : "}
                <span className="font-semibold text-slate-600 dark:text-slate-300">password</span>
                {" : "}
                <span className="font-semibold text-slate-600 dark:text-slate-300">recovery</span>
                {" (or use | as separator) → saved to log_items for the product you select (product_id)."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {status === "success" && result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex gap-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-800 text-sm dark:text-emerald-300">Upload successful</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {result.inserted} logs added · New stock <span className="font-bold">{result.newStock}</span>
                </p>
                <button type="button" onClick={handleReset} className="mt-2 text-xs font-semibold text-emerald-700 underline dark:text-emerald-400">
                  Upload more
                </button>
              </div>
            </div>
          )}

          {status === "error" && errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3 dark:border-red-900/40 dark:bg-red-950/20">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <pre className="text-xs text-red-900 dark:text-red-200 whitespace-pre-wrap break-words font-mono flex-1 min-w-0">
                {errorMsg}
              </pre>
            </div>
          )}

          {status !== "success" && (
            <>
              <div>
                <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Product</Label>
                <div className="relative mt-1.5">
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    disabled={status === "uploading"}
                    className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 pr-10 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white appearance-none"
                  >
                    {products.length === 0 && <option value="">No products</option>}
                    {products.map((p) => {
                      const optStock = liveStockById[p.id] ?? p.stock_count ?? p.stock ?? 0;
                      return (
                      <option key={p.id} value={p.id}>
                        {p.title} ({optStock} in stock)
                      </option>
                    );
                    })}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Paste logs</Label>
                  <span
                    className={`text-xs font-semibold shrink-0 ${
                      pasteValidation.ok ? "text-slate-600 dark:text-slate-300" : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {pasteValidation.ok
                      ? `${lineCount} valid line${lineCount === 1 ? "" : "s"}${skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}`
                      : `${parseLogLines(logsText).length} line(s) — need Email:Password[:Recovery]`}
                  </span>
                </div>
                <textarea
                  rows={10}
                  disabled={status === "uploading"}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-mono dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
                  placeholder={"email@domain.com:YourPassword:recovery@backup.com\nor\nemail@domain.com|YourPassword|recovery@backup.com"}
                  value={logsText}
                  onChange={(e) => {
                    setLogsText(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-2 shrink-0">
          {status !== "success" ? (
            <>
              <button
                type="button"
                onClick={handleUpload}
                disabled={
                  status === "uploading" || !pasteValidation.ok || lineCount === 0 || !selectedId
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: BTN_NAVY }}
              >
                {status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "uploading"}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: BTN_NAVY }}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Create Product Modal ─────────────────────────────────────────────────────

type CreateForm = {
  title: string;
  category: string;
  price: string;
  description: string;
  logsText: string;
};

const emptyCreateForm: CreateForm = {
  title: "",
  category: DEFAULT_PRODUCT_CATEGORY,
  price: "",
  description: "",
  logsText: "",
};

function CreateProductModal({
  open,
  onClose,
  onAfterSave,
}: {
  open: boolean;
  onClose: () => void;
  /** Extra refetch so lists (e.g. bulk upload product dropdown) include the new row immediately. */
  onAfterSave?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const { addProduct, refreshProducts, mergeProductRowFromDb, updateProduct } = useApp();
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
  const [saving, setSaving] = useState(false);
  const [createErrorMsg, setCreateErrorMsg] = useState("");

  useEffect(() => {
    if (open) {
      setForm(emptyCreateForm);
      setCreateErrorMsg("");
    }
  }, [open]);

  if (!open) return null;

  const rawLogLines = parseLogLines(form.logsText);
  const pasteRes = validatePastedLogs(form.logsText);
  const uploadEntries = pasteRes.ok ? pasteRes.entries : [];
  const skippedLogs = pasteRes.ok ? pasteRes.skipped : 0;
  const logCount = uploadEntries.length;

  const handleSubmit = async () => {
    setCreateErrorMsg("");
    if (!form.title.trim()) {
      setCreateErrorMsg("Add a product title.");
      toast({ title: "Add a product title", variant: "destructive" });
      return;
    }
    const price = parseFloat(form.price);
    if (isNaN(price) || price <= 0) {
      setCreateErrorMsg("Enter a valid price greater than 0.");
      toast({ title: "Enter a valid price", variant: "destructive" });
      return;
    }
    if (rawLogLines.length > 0 && !pasteRes.ok) {
      setCreateErrorMsg(pasteRes.message);
      toast({
        title: "Fix account lines",
        description: pasteRes.message,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const autoLogoUrl = resolveLogoUrlFromTitle(form.title.trim(), form.category);
      if (supabase) {
        const sess = await requireSupabaseUserSession();
        if (!sess.ok) {
          setCreateErrorMsg(sess.message);
          toast({
            title: "Not signed in",
            description: sess.message,
            variant: "destructive",
          });
          return;
        }
        // Refresh JWT so PostgREST evaluates `is_admin()` with up-to-date `profiles.is_admin` / `role`.
        await supabase.auth.refreshSession();

        // 1) Create product first — stock starts at 0 and RPC sets real stock next.
        const { data: inserted, error: insErr } = await supabase
          .from("products")
          .insert({
            title: form.title.trim(),
            category: form.category,
            price: Math.trunc(price),
            description: form.description.trim(),
            stock: 0,
            stock_count: 0,
            status: "sold_out",
            logo_url: autoLogoUrl ?? null,
          })
          .select("*")
          .single();

        if (insErr || !inserted) {
          const details = insErr ? formatSupabasePostgrestError(insErr) : "Insert returned no row (check RLS / SELECT policy).";
          setCreateErrorMsg(details);
          toast({
            title: "We couldn't save that",
            description: details,
            variant: "destructive",
          });
          return;
        }

        const newId = String((inserted as { id?: string }).id ?? "");
        if (!UUID_REGEX.test(newId)) {
          setCreateErrorMsg("Database did not return a valid UUID for the new product.");
          toast({
            title: "Invalid product id",
            description: "Database did not return a UUID for the new product. Try again or check Supabase.",
            variant: "destructive",
          });
          return;
        }

        mergeProductRowFromDb(inserted as Record<string, unknown>);

        // 2) Unified upload: bulk_upload_logs(p_product_id, p_logs JSON array of {email,password,recovery})
        const rpcRes = await rpcBulkUploadLogs(newId, uploadEntries);
        if (!rpcRes.ok) {
          const details = rpcRes.details;
          setCreateErrorMsg(details);
          console.error("[CreateProduct] bulk_upload_logs failed after product insert", {
            productId: newId,
            lineCount: uploadEntries.length,
            error: rpcRes.error,
            payload: rpcRes.payload,
          });
          toast({
            title: "Product created but log upload failed",
            description: details,
            variant: "destructive",
          });
          await refreshProducts();
          await onAfterSave?.();
          onClose();
          return;
        }
        const newStock = rpcRes.newStock;
        updateProduct(newId, { stock_count: newStock, stock: newStock });
        mergeProductRowFromDb({
          ...(inserted as Record<string, unknown>),
          stock: newStock,
          stock_count: newStock,
        });

        await refreshProducts();
        await onAfterSave?.();
        const desc = uploadEntries.length > 0
          ? `“${form.title.trim()}” is live with ${uploadEntries.length} account${uploadEntries.length === 1 ? "" : "s"}${skippedLogs > 0 ? ` (${skippedLogs} skipped)` : ""}.`
          : `“${form.title.trim()}” is live. Add logs anytime from inventory.`;
        sonnerToast.success("Product saved", { description: desc });
        onClose();
        return;
      }

      addProduct({
        title: form.title.trim(),
        category: form.category,
        price,
        description: form.description.trim(),
        logs: uploadEntries.map((e) => `${e.email}:${e.password}:${e.recovery}`),
        stock_count: uploadEntries.length,
        stock: uploadEntries.length,
        logo_url: autoLogoUrl,
      });
      const offDesc = `“${form.title.trim()}” added with ${uploadEntries.length} log line(s)${skippedLogs > 0 ? ` (${skippedLogs} skipped)` : ""}.`;
      sonnerToast.success("Product saved", { description: offDesc });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div
        className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white dark:border-white/10 dark:bg-slate-900">
          <h2 className="font-heading font-bold text-lg text-slate-900 dark:text-white">Create product</h2>
          <button type="button" disabled={saving} onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {createErrorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3 dark:border-red-900/40 dark:bg-red-950/20">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <pre className="text-xs text-red-900 dark:text-red-200 whitespace-pre-wrap break-words font-mono flex-1 min-w-0">
                {createErrorMsg}
              </pre>
            </div>
          )}
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Title</Label>
            <Input className="mt-1.5" value={form.title} onChange={(e) => { setCreateErrorMsg(""); setForm((f) => ({ ...f, title: e.target.value })); }} disabled={saving} placeholder="Product name" />
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-slate-950/40">
            <ProductBrandAvatar
              title={form.title.trim() || "Your product"}
              category={form.category}
              size={52}
              accentColor={BTN_NAVY}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Logo preview</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                Matches keywords in the title and category (e.g. Netflix, VPN, WhatsApp). Saves automatically when you create the product.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Category</Label>
              <select
                className="mt-1.5 w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
                value={form.category}
                onChange={(e) => { setCreateErrorMsg(""); setForm((f) => ({ ...f, category: e.target.value })); }}
                disabled={saving}
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Price (₦)</Label>
              <Input type="number" min={1} className="mt-1.5" value={form.price} onChange={(e) => { setCreateErrorMsg(""); setForm((f) => ({ ...f, price: e.target.value })); }} disabled={saving} />
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Description</Label>
            <textarea
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
              value={form.description}
              onChange={(e) => { setCreateErrorMsg(""); setForm((f) => ({ ...f, description: e.target.value })); }}
              disabled={saving}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Accounts (paste list)</Label>
              <span
                className={`text-xs font-semibold ${
                  pasteRes.ok ? "text-slate-500" : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {pasteRes.ok
                  ? `${logCount} valid line${logCount === 1 ? "" : "s"}${skippedLogs > 0 ? ` · ${skippedLogs} skipped` : ""}`
                  : `${rawLogLines.length} line(s) — need Email:Password[:Recovery]`}
              </span>
            </div>
            <textarea
              rows={8}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-mono dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
              placeholder={"email@domain.com:Password123:recovery@email.com\nor\nemail@domain.com|Password123|recovery@email.com"}
              value={form.logsText}
              onChange={(e) => { setCreateErrorMsg(""); setForm((f) => ({ ...f, logsText: e.target.value })); }}
              disabled={saving}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Each line maps to <span className="font-semibold">email</span>, <span className="font-semibold">password</span>, and{" "}
              <span className="font-semibold">recovery</span> (supports <code className="text-[11px]">:</code> or <code className="text-[11px]">|</code>; extra segments are ignored).
            </p>
            {!pasteRes.ok && rawLogLines.length > 0 && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">{pasteRes.message}</p>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex gap-2 px-6 py-4 border-t border-slate-100 bg-white dark:border-white/10 dark:bg-slate-900">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || (rawLogLines.length > 0 && !pasteRes.ok)}
            className="inline-flex flex-1 items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: BTN_NAVY }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Creating..." : "Create product"}
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit product modal ───────────────────────────────────────────────────────

function EditProductModal({
  product,
  onClose,
  onSaved,
  patchProductLocal,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  patchProductLocal: (id: string, updates: Partial<Omit<Product, "id" | "createdAt">>) => void;
}) {
  const { mergeProductRowFromDb } = useApp();
  const [title, setTitle] = useState(product.title);
  const [category, setCategory] = useState(product.category);
  const [price, setPrice] = useState(product.price.toString());
  const [description, setDescription] = useState(product.description);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    setTitle(product.title);
    setCategory(product.category);
    setPrice(product.price.toString());
    setDescription(product.description);
    setErrorMsg("");
  }, [product.id, product.title, product.category, product.price, product.description]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const n = parseFloat(price);
    if (isNaN(n) || n <= 0) {
      toast({ title: "Valid price required", variant: "destructive" });
      return;
    }

    setSaving(true);
    setErrorMsg("");
    try {
      const nextTitle = title.trim();
      const nextCategory = category.trim() || product.category;
      const autoLogoUrl = resolveLogoUrlFromTitle(nextTitle, nextCategory);
      if (supabase) {
        const { data, error } = await supabase
          .from("products")
          .update({
            title: nextTitle,
            category: nextCategory,
            price: Math.trunc(n),
            description: description.trim(),
            logo_url: autoLogoUrl ?? null,
          })
          .eq("id", product.id)
          .select("*")
          .single();

        if (error || !data) {
          const details = error
            ? formatSupabasePostgrestError(error)
            : "Update returned no row. Check SELECT policy for products.";
          setErrorMsg(details);
          toast({
            title: "We couldn't update that",
            description: details,
            variant: "destructive",
          });
          return;
        }
        mergeProductRowFromDb(data as Record<string, unknown>);
      } else {
        patchProductLocal(product.id, {
          title: nextTitle,
          category: nextCategory,
          price: Math.trunc(n),
          description: description.trim(),
          logo_url: autoLogoUrl,
        });
      }

      // Vite SPA equivalent of router.refresh(): re-fetch source-of-truth list.
      await onSaved();
      toast({ title: "You're all set", description: "Product details saved." });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10">
          <h2 className="font-heading font-bold text-slate-900 dark:text-white">Edit product</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3 dark:border-red-900/40 dark:bg-red-950/20">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <pre className="text-xs text-red-900 dark:text-red-200 whitespace-pre-wrap break-words font-mono flex-1 min-w-0">
                {errorMsg}
              </pre>
            </div>
          )}
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Name</Label>
            <Input className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} disabled={saving} />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Category</Label>
            <select
              className="mt-1.5 w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-slate-950/50 dark:text-white"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Price (₦)</Label>
            <Input type="number" min={1} className="mt-1.5" value={price} onChange={(e) => setPrice(e.target.value)} disabled={saving} />
          </div>
          <div>
            <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Description</Label>
            <textarea rows={3} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50 dark:text-white" value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-white/10 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="gap-2 text-white font-semibold border-0" style={{ background: BTN_NAVY }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Manage logs modal ─────────────────────────────────────────────────────────

function ManageLogsModal({
  product,
  onClose,
  onChanged,
}: {
  product: Product;
  onClose: () => void;
  onChanged: (productId: string, newStock: number) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [inventoryTable, setInventoryTable] = useState<"log_items" | "logs_data">("log_items");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg("");
    const q = await supabase
      .from("log_items")
      .select("id, credentials, is_delivered, created_at")
      .eq("product_id", product.id)
      .order("created_at", { ascending: true });

    let data = q.data as LogRow[] | null;
    let table: "log_items" | "logs_data" = "log_items";
    if (q.error) {
      const q2 = await supabase
        .from("logs_data")
        .select("id, credentials, is_delivered, created_at")
        .eq("product_id", product.id)
        .order("created_at", { ascending: true });
      if (q2.error) {
        setErrorMsg(formatSupabasePostgrestError(q2.error));
      }
      data = q2.data as LogRow[] | null;
      table = "logs_data";
    }
    setInventoryTable(table);

    const list = (data ?? []).map((r) => ({
      id: r.id,
      credentials: String(r.credentials ?? ""),
      is_delivered: Boolean(r.is_delivered),
      created_at: r.created_at,
    }));
    setRows(list);
    const e: Record<string, string> = {};
    for (const r of list) e[r.id] = r.credentials;
    setEdits(e);
    setLoading(false);
  }, [product.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRow = async (id: string) => {
    if (!supabase) return;
    setErrorMsg("");
    const cred = edits[id] ?? "";
    setSavingId(id);
    const { error } = await supabase.from(inventoryTable).update({ credentials: cred }).eq("id", id);
    setSavingId(null);
    if (error) {
      const details = formatSupabasePostgrestError(error);
      setErrorMsg(details);
      toast({ title: "Couldn't save line", description: details, variant: "destructive" });
      return;
    }
    const nextStock = await syncProductStockFromLogs(product.id);
    toast({ title: "You're all set", description: "Log line updated." });
    await load();
    await onChanged(product.id, nextStock);
  };

  const deleteRow = async (id: string) => {
    if (!supabase) return;
    setErrorMsg("");
    setDeletingId(id);
    const { error } = await supabase.from(inventoryTable).delete().eq("id", id);
    setDeletingId(null);
    if (error) {
      const details = formatSupabasePostgrestError(error);
      setErrorMsg(details);
      toast({ title: "Couldn't delete line", description: details, variant: "destructive" });
      return;
    }
    const nextStock = await syncProductStockFromLogs(product.id);
    toast({ title: "You're all set", description: "Log line removed." });
    await load();
    await onChanged(product.id, nextStock);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10 shrink-0">
          <div>
            <h2 className="font-heading font-bold text-slate-900 dark:text-white">Manage logs</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-md">{product.title}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {errorMsg && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3 dark:border-red-900/40 dark:bg-red-950/20">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <pre className="text-xs text-red-900 dark:text-red-200 whitespace-pre-wrap break-words font-mono flex-1 min-w-0">
                {errorMsg}
              </pre>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-12">No log rows for this product yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300 w-10">#</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 dark:text-slate-300">Credentials (raw)</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-slate-600 dark:text-slate-300 w-28">Status</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-slate-600 dark:text-slate-300 w-44">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-white/5">
                      <td className="px-3 py-2 text-slate-500 align-top">{i + 1}</td>
                      <td className="px-3 py-2 align-top">
                        <textarea
                          className="w-full min-h-[3rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
                          value={edits[r.id] ?? ""}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          disabled={r.is_delivered}
                        />
                      </td>
                      <td className="px-3 py-2 text-center align-top">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            r.is_delivered ? "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                          }`}
                        >
                          {r.is_delivered ? "Delivered" : "In stock"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right align-top space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={r.is_delivered || savingId === r.id}
                          onClick={() => void saveRow(r.id)}
                          className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                          style={{ background: BTN_NAVY }}
                        >
                          {savingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={r.is_delivered || deletingId === r.id}
                          onClick={() => void deleteRow(r.id)}
                          className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                          style={{ background: BTN_DELETE }}
                        >
                          {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 dark:border-white/10 shrink-0 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: BTN_NAVY }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminProducts() {
  const { products, updateProduct, deleteProduct, refreshProducts } = useApp();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkUploadInitialId, setBulkUploadInitialId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [manageTarget, setManageTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [liveStockById, setLiveStockById] = useState<Record<string, number>>({});

  const openBulkUploadModal = async (initialId: string | null) => {
    await refreshProducts();
    setBulkUploadInitialId(initialId);
    setShowBulkUpload(true);
  };

  const refreshLiveStocks = useCallback(async () => {
    const ids = products.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      setLiveStockById({});
      return;
    }
    const counts = await fetchLiveStockByProductIds(ids);
    setLiveStockById(counts);
  }, [products]);

  useEffect(() => {
    void refreshLiveStocks();
  }, [refreshLiveStocks]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const title = deleteTarget.title;
    setDeleting(true);
    try {
      if (supabase) {
        const invDel = await deleteInventoryForProduct(id);
        if (invDel.error) {
          toast({
            title: "We couldn't delete that",
            description: formatSupabasePostgrestError(invDel.error),
            variant: "destructive",
          });
          return;
        }

        const { error: prodErr } = await supabase.from("products").delete().eq("id", id);
        if (prodErr) {
          toast({
            title: "We couldn't delete that",
            description: formatSupabasePostgrestError(prodErr),
            variant: "destructive",
          });
          return;
        }

        // Immediate UI update — same as setProducts(prev => prev.filter(p => p.id !== id))
        deleteProduct(id);
        setLiveStockById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (manageTarget?.id === id) setManageTarget(null);
        if (editTarget?.id === id) setEditTarget(null);

        // Re-fetch from Supabase (Vite SPA: no router.refresh(); this is the source of truth).
        await refreshProducts();
        // If the catalog response was briefly stale, evict the id again so the row cannot reappear.
        deleteProduct(id);
      } else {
        deleteProduct(id);
        setLiveStockById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (manageTarget?.id === id) setManageTarget(null);
        if (editTarget?.id === id) setEditTarget(null);
      }

      const delDesc = `“${title}” and all associated logs were deleted from the database.`;
      sonnerToast.success("Product removed", { description: delDesc });
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkSuccess = async (productId: string, inserted: number, newStock: number) => {
    if (inserted > 0 && Number.isFinite(newStock) && newStock >= 0) {
      updateProduct(productId, { stock_count: newStock, stock: newStock });
    }
    await refreshProducts();
    await refreshLiveStocks();
    const desc = inserted > 0 ? `${inserted} new log line(s) added.` : "Inventory refreshed.";
    sonnerToast.success("Upload complete", { description: desc });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm dark:border-white/10 dark:bg-slate-900/60 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900 dark:text-white">Product manager</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Create products, paste accounts, manage inventory</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void openBulkUploadModal(null)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
            style={{ background: BTN_NAVY }}
          >
            <Upload className="h-4 w-4" />
            Bulk upload
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
            Create product
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-white/10 dark:bg-slate-900/60">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-white/10 bg-slate-50/80 dark:bg-white/5">
          <h2 className="font-heading font-semibold text-slate-900 dark:text-white">
            Inventory · {products.length} {products.length === 1 ? "product" : "products"}
          </h2>
        </div>
        {products.length === 0 ? (
          <div className="px-6 py-20 flex flex-col items-center justify-center text-center">
            <PackagePlus className="h-14 w-14 text-slate-300 dark:text-slate-600 mb-4" aria-hidden />
            <p className="text-lg font-semibold text-slate-900 dark:text-white">No products found</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md leading-relaxed">
              Start by creating your first product. You can paste accounts in bulk after it exists.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-8 inline-flex items-center justify-center gap-2 px-10 py-4 rounded-2xl text-base font-bold text-white shadow-lg hover:opacity-95 transition-opacity"
              style={{ background: BTN_NAVY }}
            >
              <Plus className="h-6 w-6 shrink-0" />
              Add product
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/10 text-left">
                  <th className="px-3 py-3 w-14 font-semibold text-slate-600 dark:text-slate-400 text-center" aria-label="Logo" />
                  <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-400">Product</th>
                  <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-400 text-center">Category</th>
                  <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-400 text-right">Price</th>
                  <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-400 text-center">Stock</th>
                  <th className="px-5 py-3 font-semibold text-slate-600 dark:text-slate-400 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                {products.map((product) => {
                  const stock =
                    product.id in liveStockById
                      ? liveStockById[product.id]!
                      : (product.stock_count ?? product.stock ?? 0);
                  return (
                  <tr key={product.id} className="hover:bg-slate-50/60 dark:hover:bg-white/5">
                    <td className="px-3 py-3 align-middle">
                      <div className="flex justify-center">
                        <ProductBrandAvatar
                          title={product.title}
                          category={product.category}
                          logo_url={product.logo_url}
                          size={40}
                          accentColor={BTN_NAVY}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4 max-w-[280px]">
                      <p className="font-medium text-slate-900 dark:text-white truncate">{product.title}</p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{product.description}</p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold dark:bg-white/10 dark:text-slate-200">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-slate-900 dark:text-white">₦{product.price.toLocaleString()}</td>
                    <td className="px-5 py-4 text-center">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          stock > 5
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : stock > 0
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                              : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                        }`}
                      >
                        {stock}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <button
                          type="button"
                          title="Manage logs"
                          onClick={() => setManageTarget(product)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white"
                          style={{ background: BTN_NAVY }}
                        >
                          <List className="h-3.5 w-3.5" />
                          Manage logs
                        </button>
                        <button
                          type="button"
                          title="Bulk upload"
                          onClick={() => void openBulkUploadModal(product.id)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => setEditTarget(product)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delete product"
                          onClick={() => setDeleteTarget(product)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-white"
                          style={{ background: BTN_DELETE }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product and all its logs? This cannot be undone.
              {deleteTarget && <span className="block mt-2 font-medium text-foreground">“{deleteTarget.title}”</span>}
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
              className="text-white border-0"
              style={{ background: BTN_DELETE }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateProductModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onAfterSave={() => void refreshProducts()}
      />

      {showBulkUpload && (
        <BulkUploadModal
          products={products}
          liveStockById={liveStockById}
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
          onSaved={async () => {
            await refreshProducts();
            await refreshLiveStocks();
          }}
          patchProductLocal={updateProduct}
        />
      )}

      {manageTarget && (
        <ManageLogsModal
          product={manageTarget}
          onClose={() => setManageTarget(null)}
          onChanged={async (productId, newStock) => {
            updateProduct(productId, { stock_count: newStock, stock: newStock });
            await refreshProducts();
            await refreshLiveStocks();
          }}
        />
      )}
    </div>
  );
}
