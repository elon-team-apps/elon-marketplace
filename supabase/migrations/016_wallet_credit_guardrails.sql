-- Enforce wallet integrity:
-- 1) wallet_balance always defaults to 0 and stays non-negative
-- 2) wallet is credited only when deposit transactions transition into a success status
-- 3) authenticated users can update their own profile, but cannot directly change wallet_balance

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_balance numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ALTER COLUMN wallet_balance SET DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_wallet_balance_nonnegative;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_wallet_balance_nonnegative
  CHECK (wallet_balance >= 0);

CREATE OR REPLACE FUNCTION public.apply_wallet_credit_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_status text := lower(coalesce(OLD.status, ''));
  new_status text := lower(coalesce(NEW.status, ''));
  tx_type text := lower(coalesce(NEW.type, ''));
  credit_amount numeric := coalesce(NEW.amount, 0);
BEGIN
  IF tx_type NOT IN ('deposit', 'wallet_topup') THEN
    RETURN NEW;
  END IF;

  -- Credit only once when status moves from non-success -> success.
  IF new_status IN ('completed', 'success', 'finalized')
     AND old_status NOT IN ('completed', 'success', 'finalized') THEN
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'Deposit transaction % has no user_id', NEW.id;
    END IF;

    IF credit_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit transaction % has invalid amount: %', NEW.id, credit_amount;
    END IF;

    UPDATE public.profiles
    SET wallet_balance = coalesce(wallet_balance, 0) + credit_amount
    WHERE id = NEW.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No profile found for user_id % (transaction %)', NEW.user_id, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_wallet_credit_from_transaction ON public.transactions;

CREATE TRIGGER trg_apply_wallet_credit_from_transaction
AFTER UPDATE OF status ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.apply_wallet_credit_from_transaction();

CREATE OR REPLACE FUNCTION public.is_wallet_balance_unchanged_for_self(new_wallet numeric)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND coalesce(p.wallet_balance, 0) = coalesce(new_wallet, 0)
  );
$$;

DROP POLICY IF EXISTS "profiles: owner update" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile_no_wallet" ON public.profiles;

CREATE POLICY "users_update_own_profile_no_wallet"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND public.is_wallet_balance_unchanged_for_self(wallet_balance)
  );

COMMIT;
