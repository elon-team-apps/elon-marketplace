CREATE INDEX IF NOT EXISTS idx_transactions_type_status_reference
  ON public.transactions (type, status, reference);

CREATE INDEX IF NOT EXISTS idx_transactions_type_status_created_at
  ON public.transactions (type, status, created_at DESC);
