import type { PostgrestError } from "@supabase/supabase-js";

/** Red-box / toast text: Supabase PostgREST fields in a fixed order (code + message first). */
export function formatSupabasePostgrestError(err: PostgrestError | null | undefined): string {
  if (!err) return "";
  const parts: string[] = [];
  if (err.code) parts.push(`code: ${err.code}`);
  if (err.message) parts.push(`message: ${err.message}`);
  if (err.details) parts.push(`details: ${err.details}`);
  if (err.hint) parts.push(`hint: ${err.hint}`);
  return parts.join("\n");
}

export function isLikelySchemaOrMissingColumnError(err: PostgrestError | null | undefined): boolean {
  if (!err) return false;
  const blob = `${err.message}\n${err.details ?? ""}\n${err.hint ?? ""}\n${err.code ?? ""}`.toLowerCase();
  return /column|schema cache|42703|pgrst204|could not find|undefined column/i.test(blob);
}

/**
 * Full text for failed `.rpc()` calls: PostgREST transport error (message, details, hint, code)
 * plus JSON body when the function returns `{ success: false, ... }`.
 */
export function formatPostgrestRpcFailure(
  error: PostgrestError | null | undefined,
  payload: unknown,
): string {
  const blocks: string[] = [];

  if (payload !== undefined && payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (p.success === false && typeof p.message === "string" && p.message) {
      blocks.push(`Database (RPC SQLERRM / message):\n${p.message}`);
    }
    if (typeof p.sqlstate === "string" && p.sqlstate) {
      blocks.push(`SQLSTATE: ${p.sqlstate}`);
    }
  }

  if (error) {
    const pe = formatSupabasePostgrestError(error);
    if (pe) blocks.push(`PostgREST / transport:\n${pe}`);
    try {
      const serializable = { ...error } as Record<string, unknown>;
      blocks.push(`PostgREST error (raw JSON): ${JSON.stringify(serializable)}`);
    } catch {
      blocks.push(`PostgREST error (string): ${String(error)}`);
    }
  }

  if (payload !== undefined && payload !== null) {
    if (typeof payload === "object" && !Array.isArray(payload)) {
      const p = payload as Record<string, unknown>;
      if (p.success === false) {
        if (typeof p.code === "string" && p.code) blocks.push(`RPC code: ${p.code}`);
      }
      try {
        blocks.push(`Full RPC response (JSON): ${JSON.stringify(payload)}`);
      } catch {
        blocks.push(`RPC response: ${String(payload)}`);
      }
    } else {
      blocks.push(`RPC response: ${String(payload)}`);
    }
  }

  if (blocks.length === 0) {
    return (
      "No error details were returned. In DevTools → Network, find the request to " +
      "`/rest/v1/rpc/bulk_upload_logs` (or your RPC name) and read the response body and status code."
    );
  }

  return blocks.join("\n\n— — —\n\n");
}
