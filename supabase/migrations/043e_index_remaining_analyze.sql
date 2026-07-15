-- Run FIFTH (last) — remaining smaller tables + ANALYZE
CREATE INDEX IF NOT EXISTS idx_products_created_at_desc
  ON public.products (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_created_at_desc
  ON public.transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at_desc
  ON public.activity_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id
  ON public.product_reviews (product_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id
  ON public.user_favorites (user_id);

-- Force Postgres to update query planner statistics
ANALYZE public.log_items;
ANALYZE public.transactions;
ANALYZE public.deposits;
ANALYZE public.profiles;
ANALYZE public.products;
