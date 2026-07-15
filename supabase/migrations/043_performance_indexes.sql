-- =============================================================================
-- Migration 043 — Performance Indexes to Reduce Disk IO
--
-- Your Supabase project has exhausted its Disk IO budget. This migration adds
-- targeted indexes on the columns & patterns that are queried most frequently
-- by the application, reducing full-table scans and lowering overall IO.
-- =============================================================================

-- ─── 1. log_items: composite index for the FIFO claim query ─────────────────
-- The purchase_log() and fulfill_paystack_purchase() RPCs both run:
--   WHERE product_id = ? AND is_delivered = FALSE ORDER BY created_at ASC
-- A composite index avoids scanning the entire log_items table (which can be
-- the largest table by row count).
CREATE INDEX IF NOT EXISTS idx_log_items_product_undelivered
  ON public.log_items (product_id, is_delivered, created_at ASC)
  WHERE is_delivered = FALSE;

-- ─── 2. log_items: composite for get_live_stock() RPC ───────────────────────
-- get_live_stock() runs:
--   WHERE product_id = ? AND is_delivered = FALSE AND status = 'available'
-- The partial index above covers part of this, but if 'status' column exists,
-- this dedicated index helps too.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'log_items'
      AND column_name = 'status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_log_items_stock_available
      ON public.log_items (product_id)
      WHERE is_delivered = FALSE AND status = ''available''';
  END IF;
END $$;

-- ─── 3. log_items: product_id index (if missing after rename) ───────────────
-- The original idx_logs_data_product_id was on the old table name. After
-- ALTER TABLE RENAME, Postgres keeps the index but the name may confuse.
-- Ensure a clean index exists on log_items.
CREATE INDEX IF NOT EXISTS idx_log_items_product_id
  ON public.log_items (product_id);

CREATE INDEX IF NOT EXISTS idx_log_items_is_delivered
  ON public.log_items (is_delivered);

-- ─── 4. transactions: user_id + type + status (user order history) ──────────
-- OrdersPage fetches:  WHERE user_id = ? AND type = 'purchase' AND status = 'completed'
-- PaymentsPage:        WHERE user_id = ? ORDER BY created_at DESC
-- This composite index serves both patterns efficiently.
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_status
  ON public.transactions (user_id, type, status);

-- ─── 5. transactions: created_at DESC for admin dashboard ───────────────────
-- AdminDashboard queries transactions ordered by created_at descending.
CREATE INDEX IF NOT EXISTS idx_transactions_created_at_desc
  ON public.transactions (created_at DESC);

-- ─── 6. transactions: log_id for RLS policy lookups ─────────────────────────
-- The "logs_data: buyer read after purchase" RLS policy runs:
--   EXISTS (SELECT 1 FROM transactions WHERE log_id = ? AND user_id = ? ...)
-- Without an index on log_id, this is a full table scan PER log row viewed.
CREATE INDEX IF NOT EXISTS idx_transactions_log_id
  ON public.transactions (log_id)
  WHERE log_id IS NOT NULL;

-- ─── 7. deposits: user_id + status for user/admin queries ───────────────────
-- Users see their own deposits; admins filter by status = 'pending'.
CREATE INDEX IF NOT EXISTS idx_deposits_user_id
  ON public.deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_deposits_status
  ON public.deposits (status);

CREATE INDEX IF NOT EXISTS idx_deposits_created_at_desc
  ON public.deposits (created_at DESC);

-- ─── 8. profiles: role / is_admin for the is_admin() function ───────────────
-- The is_admin() function is called by nearly every RLS policy. It queries:
--   WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
-- The PK already covers the id lookup, but a partial index on admin users
-- speeds up the EXISTS check since very few users are admins.
CREATE INDEX IF NOT EXISTS idx_profiles_admin
  ON public.profiles (id)
  WHERE is_admin = true OR role = 'admin';

-- ─── 9. activity_logs: user_id + created_at for admin dashboard ─────────────
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id
  ON public.activity_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at_desc
  ON public.activity_logs (created_at DESC);

-- ─── 10. product_reviews: product_id for storefront display ─────────────────
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id
  ON public.product_reviews (product_id);

-- ─── 11. user_favorites: user_id for "my favorites" queries ─────────────────
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id
  ON public.user_favorites (user_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_product_id
  ON public.user_favorites (product_id);

-- ─── 12. products: created_at DESC for storefront listing order ─────────────
-- refreshProducts() queries: ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_products_created_at_desc
  ON public.products (created_at DESC);

-- ─── 13. ANALYZE all affected tables ────────────────────────────────────────
-- Force Postgres to update statistics so the query planner uses the new indexes
-- immediately rather than waiting for autovacuum.
ANALYZE public.log_items;
ANALYZE public.transactions;
ANALYZE public.deposits;
ANALYZE public.profiles;
ANALYZE public.products;
ANALYZE public.activity_logs;
ANALYZE public.product_reviews;
ANALYZE public.user_favorites;
