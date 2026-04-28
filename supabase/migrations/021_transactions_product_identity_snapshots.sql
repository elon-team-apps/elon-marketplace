-- Preserve product identity on transactions so Orders history remains readable
-- even if products are later edited or deleted.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS product_title_snapshot text NOT NULL DEFAULT '';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS product_category_snapshot text NOT NULL DEFAULT '';

UPDATE public.transactions t
SET
  product_title_snapshot = COALESCE(p.title, ''),
  product_category_snapshot = COALESCE(p.category, '')
FROM public.products p
WHERE t.product_id = p.id
  AND (
    COALESCE(t.product_title_snapshot, '') = ''
    OR COALESCE(t.product_category_snapshot, '') = ''
  );
