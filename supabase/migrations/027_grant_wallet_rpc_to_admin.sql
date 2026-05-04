-- Migration: Grant increment_wallet_balance to authenticated users and add admin check
-- This ensures admins can use the RPC for safe, atomic wallet top-ups.

-- 1. Grant execute permission
GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, numeric) TO authenticated;

-- 2. Update the function to include an admin check (unless the user is updating themselves?)
-- Actually, the RPC is intended for admins or system-level updates.
-- Let's make it explicitly check for is_admin() or service_role.

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
  -- Security check: Must be an admin OR service_role (service_role has all permissions by default but we can be explicit)
  IF NOT (public.is_admin() OR (auth.role() = 'service_role')) THEN
    RAISE EXCEPTION 'Forbidden: only admins can manually adjust wallets.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  
  -- We allow negative amounts for deductions if called via this RPC
  -- IF p_amount IS NULL OR p_amount <= 0 THEN ...
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'p_amount is required';
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
