-- Run SECOND — covers the RLS policy on transactions (log_id lookups)
CREATE INDEX IF NOT EXISTS idx_transactions_log_id
  ON public.transactions (log_id)
  WHERE log_id IS NOT NULL;
