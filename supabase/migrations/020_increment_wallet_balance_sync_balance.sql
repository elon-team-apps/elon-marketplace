-- Keep legacy `profiles.balance` (if present) in sync with `wallet_balance` on top-ups.
-- Webhook + app use RPC `increment_wallet_balance`; this version is backward compatible.

CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next numeric;
  v_has_balance boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be > 0';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'profiles'
      AND c.column_name = 'balance'
  ) INTO v_has_balance;

  IF v_has_balance THEN
    EXECUTE $q$
      UPDATE public.profiles
      SET
        wallet_balance = COALESCE(wallet_balance, 0) + $1,
        balance = COALESCE(balance, 0) + $1
      WHERE id = $2
      RETURNING wallet_balance
    $q$
    INTO v_next
    USING p_amount, p_user_id;
  ELSE
    UPDATE public.profiles
    SET wallet_balance = COALESCE(wallet_balance, 0) + p_amount
    WHERE id = p_user_id
    RETURNING wallet_balance INTO v_next;
  END IF;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Profile not found for user_id %', p_user_id;
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, numeric) TO service_role;
