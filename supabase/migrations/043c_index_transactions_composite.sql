-- Run THIRD — composite index for user order/payment history queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_status
  ON public.transactions (user_id, type, status);
