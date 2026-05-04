-- Migration: Fix missing columns and ensure alignment with frontend expectations
-- This adds manual_stock to products and ensures log_items has content/status/email/password/recovery.

-- 1. Products Table
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manual_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_count INTEGER;

-- Backfill stock_count if null
UPDATE public.products
SET stock_count = stock
WHERE stock_count IS NULL;

-- 2. Log Items Table (renamed from logs_data in migration 009)
-- Ensure all used columns exist
ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recovery TEXT NOT NULL DEFAULT '';

-- 3. Update Policies for log_items (just in case they weren't updated after rename)
-- Admins need full access to manage logs
DROP POLICY IF EXISTS "log_items: admin insert" ON public.log_items;
CREATE POLICY "log_items: admin insert"
  ON public.log_items FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "log_items: admin select" ON public.log_items;
CREATE POLICY "log_items: admin select"
  ON public.log_items FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "log_items: admin update" ON public.log_items;
CREATE POLICY "log_items: admin update"
  ON public.log_items FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "log_items: admin delete" ON public.log_items;
CREATE POLICY "log_items: admin delete"
  ON public.log_items FOR DELETE
  USING (public.is_admin());

-- 4. Re-verify buy-side read policy
DROP POLICY IF EXISTS "log_items: buyer read after purchase" ON public.log_items;
CREATE POLICY "log_items: buyer read after purchase"
  ON public.log_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.log_id    = log_items.id
        AND t.user_id   = auth.uid()
        AND t.type      = 'purchase'
        AND t.status    = 'completed'
    )
  );
