-- Canonical raw inventory line (exact paste from admin). Kept alongside `credentials` for backward compatibility.

ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS content text;

COMMENT ON COLUMN public.log_items.content IS 'Raw log line as pasted in admin (no parsing).';
