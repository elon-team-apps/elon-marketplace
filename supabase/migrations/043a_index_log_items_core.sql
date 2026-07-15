-- Run this FIRST — it's the most impactful single index.
-- Covers the purchase_log() FIFO claim query.
CREATE INDEX IF NOT EXISTS idx_log_items_product_undelivered
  ON public.log_items (product_id, created_at ASC)
  WHERE is_delivered = FALSE;
