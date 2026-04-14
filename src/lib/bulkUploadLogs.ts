import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { formatPostgrestRpcFailure } from "@/lib/supabaseErrors";
import type { ParsedLogEntry } from "@/lib/logParser";

export type BulkUploadRpcResult =
  | { ok: true; inserted: number; newStock: number; raw: Record<string, unknown> }
  | { ok: false; details: string; error: PostgrestError | null; payload: Record<string, unknown> | null };

/**
 * Calls `bulk_upload_logs(p_product_id UUID, p_logs JSONB)` with an array of
 * `{ email, password, recovery }` objects (matches Supabase migration 015+).
 */
export async function rpcBulkUploadLogs(
  productId: string,
  entries: ParsedLogEntry[],
): Promise<BulkUploadRpcResult> {
  if (!supabase) {
    return { ok: false, details: "Supabase is not configured.", error: null, payload: null };
  }

  const p_logs = entries.map((e) => ({
    email: e.email,
    password: e.password,
    recovery: e.recovery,
  }));

  let { data, error } = await supabase.rpc("bulk_upload_logs", {
    p_product_id: productId,
    p_logs,
  });

  // Backward-compatible payload fallback for older SQL functions that expect `{ logs: [...] }`.
  if (error) {
    const normalizedMessage = (error.message ?? "").toLowerCase();
    const isJsonOperatorMismatch =
      normalizedMessage.includes("operator does not exist") ||
      normalizedMessage.includes("cannot extract elements from an object") ||
      normalizedMessage.includes("cannot extract elements from a scalar");
    if (isJsonOperatorMismatch) {
      const retry = await supabase.rpc("bulk_upload_logs", {
        p_product_id: productId,
        p_logs: { logs: p_logs },
      });
      data = retry.data;
      error = retry.error;
    }
  }

  const payload = (data ?? null) as Record<string, unknown> | null;

  if (error || !payload?.success) {
    return {
      ok: false,
      details: formatPostgrestRpcFailure(error, payload),
      error,
      payload,
    };
  }

  return {
    ok: true,
    inserted: Number(payload.inserted ?? 0),
    newStock: Number(payload.new_stock ?? 0),
    raw: payload,
  };
}
