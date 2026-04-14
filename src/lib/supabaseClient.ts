import { createClient } from "@supabase/supabase-js";

export const resolvedSupabaseUrl = (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ?? undefined;
export const resolvedSupabaseAnonKey = (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ?? undefined;

if (!resolvedSupabaseUrl || !resolvedSupabaseAnonKey) {
  console.warn(
    "[Supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
    "The app will run in offline/localStorage mode. " +
    "Copy .env.example to .env and fill in your project credentials."
  );
}

// Exported as nullable — always guard with `if (supabase)` before calling
export const supabase =
  resolvedSupabaseUrl && resolvedSupabaseAnonKey
    ? createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
      auth: {
        persistSession: true,
        storageKey: "elon-auth-token",
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    : null;

/** First subdomain of *.supabase.co — used to detect JWT vs project URL mismatch */
export function supabaseProjectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const m = host.match(/^([^.]+)\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ─── Convenience type helpers (generated from our schema) ─────────────────────

export type UserRole = "user" | "admin";
export type TransactionType = "deposit" | "purchase";
export type TransactionStatus = "pending" | "completed" | "failed";
export type ProductStatus = "available" | "sold_out";

export interface Profile {
  id: string;
  name: string;
  email: string;
  wallet_balance: number;
  role: UserRole;
  /** When true, user has admin privileges (RLS `is_admin()` matches this or legacy `role`). */
  is_admin?: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  title: string;
  category: string;
  price: number;
  description: string | null;
  stock_count: number;
  stock?: number;
  status: ProductStatus;
  preview_data: Record<string, unknown> | null;
  created_at: string;
}

export interface LogEntry {
  id: string;
  product_id: string;
  credentials: string;          // encrypted at rest; only readable via RLS after purchase
  is_delivered: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  product_id: string | null;
  log_id: string | null;
  reference: string | null;     // Paystack reference — used for idempotency
  quantity?: number;
  created_at: string;
}
