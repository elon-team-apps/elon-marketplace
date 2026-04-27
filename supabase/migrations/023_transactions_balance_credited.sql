ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS balance_credited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.transactions.balance_credited IS
  'True when deposit amount has already been applied to wallet balance.';
