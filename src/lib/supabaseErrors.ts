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
