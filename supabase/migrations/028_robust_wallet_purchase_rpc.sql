-- Migration: Robust atomic wallet purchase RPC
-- Handles multi-quantity purchases with strict balance and stock checks.
-- Synchronizes legacy `balance` column if it exists.
-- Captures product identity snapshots for transaction history stability.

-- Ensure pgcrypto is available for random string generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

  -- 7. Deduct Balance
  -- We use dynamic SQL to handle cases where 'balance' column might not exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'balance'
  ) INTO v_has_balance_col;

  IF v_has_balance_col THEN
    EXECUTE 'UPDATE public.profiles SET wallet_balance = wallet_balance - $1, balance = balance - $1 WHERE id = $2'
    USING v_total_price, v_user_id;
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
  BEGIN
    v_reference := 'wlt_' || encode(gen_random_bytes(6), 'hex');
  EXCEPTION WHEN OTHERS THEN
    -- Fallback if pgcrypto is missing or inaccessible
    v_reference := 'wlt_' || floor(extract(epoch from now()))::text || '_' || floor(random() * 1000000)::text;
  END;
  
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
      'true'::jsonb
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

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.process_wallet_purchase(UUID, INTEGER) TO authenticated;
