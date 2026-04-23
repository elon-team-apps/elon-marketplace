-- Snapshot product description on each transaction so receipts keep original
-- purchase instructions even if product description changes later.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS product_description text NOT NULL DEFAULT '';

UPDATE public.transactions t
SET product_description = COALESCE(p.description, '')
FROM public.products p
WHERE t.product_id = p.id
  AND COALESCE(t.product_description, '') = '';
