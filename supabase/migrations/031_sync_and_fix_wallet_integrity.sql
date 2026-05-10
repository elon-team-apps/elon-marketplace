-- Migration: Sync and Fix Wallet Integrity
-- 1. Synchronize legacy `balance` column with canonical `wallet_balance`.
-- 2. Update all wallet-modifying functions to consistently sync both columns.
-- 3. Ensure check constraints do not block valid deductions due to sync issues.

BEGIN;

-- 1. Synchronize profiles
-- We ensure 'balance' matches 'wallet_balance' so that legacy constraints or triggers (like notifications) work correctly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'balance'
  ) THEN
    UPDATE public.profiles
    SET balance = wallet_balance
    WHERE balance IS DISTINCT FROM wallet_balance;
  END IF;
END $$;


-- 2. Update increment_wallet_balance RPC (from 027)
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
  -- Security check: Must be an admin OR service_role
  IF NOT (public.is_admin() OR (auth.role() = 'service_role')) THEN
    RAISE EXCEPTION 'Forbidden: only admins can manually adjust wallets.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  
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
    -- Ensure both columns are updated and in sync
    UPDATE public.profiles
    SET
      wallet_balance = COALESCE(wallet_balance, 0) + p_amount,
      balance = COALESCE(wallet_balance, 0) + p_amount -- Sync with the NEW wallet_balance
    WHERE id = p_user_id
    RETURNING wallet_balance INTO v_next;
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


-- 3. Update process_wallet_purchase RPC (from 028)
CREATE OR REPLACE FUNCTION public.process_wallet_purchase(
  p_product_id UUID,
  p_quantity INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_product RECORD;
  v_balance NUMERIC;
  v_total_price NUMERIC;
  v_log_ids UUID[];
  v_log_contents TEXT;
  v_tx_id UUID;
  v_reference TEXT;
  v_has_balance_col BOOLEAN;
  v_has_delivered_data BOOLEAN;
  v_has_snapshots BOOLEAN;
BEGIN
  -- 1. Authentication Check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Authentication required.');
  END IF;

  -- 2. Validate Inputs
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid quantity.');
  END IF;

  -- 3. Lock Profile (Atomic Read + Lock)
  SELECT wallet_balance INTO v_balance
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User profile not found.');
  END IF;

  -- 4. Lock Product (Atomic Read + Lock)
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  v_total_price := v_product.price * p_quantity;

  -- 5. Strict Balance Check
  IF v_balance < v_total_price THEN
    RETURN jsonb_build_object(
      'success', false, 
      'message', format('Insufficient balance. Have ₦%s, Need ₦%s.', v_balance, v_total_price),
      'code', 'INSUFFICIENT_BALANCE'
    );
  END IF;

  -- 6. Strict Stock Check (Available Logs)
  SELECT array_agg(id) INTO v_log_ids
  FROM (
    SELECT id
    FROM public.log_items
    WHERE product_id = p_product_id
      AND is_delivered = FALSE
      AND status = 'available'
    ORDER BY created_at ASC
    LIMIT p_quantity
    FOR UPDATE SKIP LOCKED
  ) t;

  IF v_log_ids IS NULL OR array_length(v_log_ids, 1) < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient stock for this quantity.');
  END IF;

  -- 7. Deduct Balance (Syncing both columns)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'balance'
  ) INTO v_has_balance_col;

  IF v_has_balance_col THEN
    -- Consistently update both to stay in sync
    UPDATE public.profiles 
    SET 
      wallet_balance = wallet_balance - v_total_price, 
      balance = wallet_balance - v_total_price 
    WHERE id = v_user_id;
  ELSE
    UPDATE public.profiles
    SET wallet_balance = wallet_balance - v_total_price
    WHERE id = v_user_id;
  END IF;

  -- 8. Mark Logs as Delivered
  UPDATE public.log_items
  SET is_delivered = TRUE,
      status = 'delivered',
      buyer_id = v_user_id
  WHERE id = ANY(v_log_ids);

  -- 9. Collect Delivered Data
  SELECT string_agg(val, E'\n') INTO v_log_contents
  FROM (
    SELECT COALESCE(content, credentials, '') as val
    FROM public.log_items
    WHERE id = ANY(v_log_ids)
    ORDER BY created_at ASC
  ) sub;

  -- 10. Update Product Aggregate Stock
  UPDATE public.products
  SET stock = stock - p_quantity,
      status = CASE WHEN stock - p_quantity <= 0 THEN 'sold_out' ELSE 'available' END
  WHERE id = p_product_id;

  -- 11. Create Transaction Audit Record
  v_reference := 'wlt_' || encode(gen_random_bytes(6), 'hex');
  
  -- Check for delivered_data and snapshot columns
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'delivered_data') INTO v_has_delivered_data;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'product_title_snapshot') INTO v_has_snapshots;

  IF v_has_delivered_data AND v_has_snapshots THEN
    INSERT INTO public.transactions (
      user_id, amount, type, status, reference, product_id, quantity, 
      delivered_data, product_description, product_title_snapshot, product_category_snapshot,
      credentials_delivered
    )
    VALUES (
      v_user_id, v_total_price, 'purchase', 'completed', v_reference, p_product_id, p_quantity, 
      v_log_contents, COALESCE(v_product.description, ''), COALESCE(v_product.title, ''), COALESCE(v_product.category, ''),
      TRUE
    )
    RETURNING id INTO v_tx_id;
  ELSIF v_has_delivered_data THEN
    INSERT INTO public.transactions (
      user_id, amount, type, status, reference, product_id, quantity, delivered_data
    )
    VALUES (
      v_user_id, v_total_price, 'purchase', 'completed', v_reference, p_product_id, p_quantity, v_log_contents
    )
    RETURNING id INTO v_tx_id;
  ELSE
    INSERT INTO public.transactions (
      user_id, amount, type, status, reference, product_id, quantity
    )
    VALUES (
      v_user_id, v_total_price, 'purchase', 'completed', v_reference, p_product_id, p_quantity
    )
    RETURNING id INTO v_tx_id;
  END IF;

  -- 12. Return Success with Payload
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Purchase successful',
    'transaction_id', v_tx_id,
    'reference', v_reference,
    'delivered_data', v_log_contents,
    'wallet_balance', v_balance - v_total_price,
    'quantity', p_quantity
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Internal purchase error: ' || SQLERRM,
    'code', SQLSTATE
  );
END;
$$;


-- 4. Update apply_wallet_credit_from_transaction trigger (from 030)
CREATE OR REPLACE FUNCTION public.apply_wallet_credit_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_status text := CASE WHEN TG_OP = 'INSERT' THEN '' ELSE lower(coalesce(OLD.status, '')) END;
  new_status text := lower(coalesce(NEW.status, ''));
  tx_type text := lower(coalesce(NEW.type, ''));
  credit_amount numeric := coalesce(NEW.amount, 0);
  is_already_credited boolean := CASE WHEN TG_OP = 'INSERT' THEN false ELSE coalesce(OLD.balance_credited, false) END;
  v_has_balance_col boolean;
BEGIN
  -- Only process deposits/topups
  IF tx_type NOT IN ('deposit', 'wallet_topup') THEN
    RETURN NEW;
  END IF;

  -- Prevent double crediting if balance_credited is already true (on update)
  IF is_already_credited THEN
    RETURN NEW;
  END IF;

  -- Credit only once when status moves from non-success -> success.
  IF (new_status IN ('completed', 'success', 'finalized', 'successful'))
     AND (old_status NOT IN ('completed', 'success', 'finalized', 'successful')) THEN
    
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'Deposit transaction % has no user_id', NEW.id;
    END IF;

    IF credit_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit transaction % has invalid amount: %', NEW.id, credit_amount;
    END IF;

    -- Check for legacy balance column
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'balance'
    ) INTO v_has_balance_col;

    -- Update balance (Syncing both columns)
    IF v_has_balance_col THEN
      UPDATE public.profiles
      SET 
        wallet_balance = coalesce(wallet_balance, 0) + credit_amount,
        balance = coalesce(wallet_balance, 0) + credit_amount -- Sync with the NEW wallet_balance
      WHERE id = NEW.user_id;
    ELSE
      UPDATE public.profiles
      SET wallet_balance = coalesce(wallet_balance, 0) + credit_amount
      WHERE id = NEW.user_id;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No profile found for user_id % (transaction %)', NEW.user_id, NEW.id;
    END IF;

    -- Mark as credited to prevent any other logic from double-dipping
    NEW.balance_credited := true;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
