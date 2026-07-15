-- Run FOURTH — deposits & profiles indexes
CREATE INDEX IF NOT EXISTS idx_deposits_user_id
  ON public.deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_deposits_status
  ON public.deposits (status);

CREATE INDEX IF NOT EXISTS idx_profiles_admin
  ON public.profiles (id)
  WHERE is_admin = true OR role = 'admin';
