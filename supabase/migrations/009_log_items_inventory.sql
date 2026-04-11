-- =============================================================================
-- Inventory table rename: logs_data → log_items (app + admin bulk upload).
-- Idempotent: skips rename if log_items already exists or logs_data is gone.
-- Then refresh RPCs to reference public.log_items.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.logs_data') IS NOT NULL
     AND to_regclass('public.log_items') IS NULL THEN
    ALTER TABLE public.logs_data RENAME TO log_items;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- bulk_upload_logs — insert into log_items, return real errors on failure
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_upload_logs(
  p_product_id  UUID,
  p_credentials TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted  INTEGER;
  v_new_stock INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Forbidden: admin only.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  INSERT INTO public.log_items (product_id, credentials)
  SELECT p_product_id, cred
  FROM unnest(p_credentials) AS cred
  WHERE trim(cred) <> '';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'No valid log lines found.');
  END IF;

  SELECT COUNT(*) INTO v_new_stock
  FROM public.log_items
  WHERE product_id = p_product_id
    AND is_delivered = FALSE;

  UPDATE public.products
  SET
    stock  = v_new_stock,
    status = CASE WHEN v_new_stock > 0 THEN 'available' ELSE 'sold_out' END
  WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'success',   true,
    'inserted',  v_inserted,
    'new_stock', v_new_stock
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',   false,
    'message',   SQLERRM,
    'sqlstate',  SQLSTATE
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- purchase_log — FIFO claim from log_items
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_log(
  p_user_id    UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product     public.products%ROWTYPE;
  v_log         public.log_items%ROWTYPE;
  v_balance     INTEGER;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  IF v_product.stock = 0 OR v_product.status = 'sold_out' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Out of stock.');
  END IF;

  SELECT wallet_balance INTO v_balance
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance < v_product.price THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', format('Insufficient balance. Need ₦%s more.',
                         (v_product.price - v_balance)::TEXT)
    );
  END IF;

  SELECT * INTO v_log
  FROM public.log_items
  WHERE product_id = p_product_id
    AND is_delivered = FALSE
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Out of stock.');
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - v_product.price
  WHERE id = p_user_id;

  UPDATE public.log_items
  SET is_delivered = TRUE
  WHERE id = v_log.id;

  UPDATE public.products
  SET
    stock  = stock - 1,
    status = CASE WHEN stock - 1 = 0 THEN 'sold_out' ELSE 'available' END
  WHERE id = p_product_id;

  INSERT INTO public.transactions (user_id, amount, type, status, product_id, log_id)
  VALUES (p_user_id, v_product.price, 'purchase', 'completed', p_product_id, v_log.id)
  RETURNING * INTO v_transaction;

  RETURN jsonb_build_object(
    'success',      true,
    'message',      'Purchase successful.',
    'log_id',       v_log.id,
    'credentials',  v_log.credentials,
    'transaction_id', v_transaction.id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

-- -----------------------------------------------------------------------------
-- fulfill_paystack_purchase — Paystack webhook fulfillment via log_items
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_paystack_purchase(
  p_reference TEXT,
  p_amount_naira INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx         public.transactions%ROWTYPE;
  v_log        public.log_items%ROWTYPE;
  v_creds      JSONB := '[]'::jsonb;
  v_i          INTEGER;
  v_need       INTEGER;
  v_available  INTEGER;
BEGIN
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE reference = p_reference
    AND type = 'purchase'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Purchase reference not found.');
  END IF;

  IF v_tx.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Already processed.',
      'idempotent', true
    );
  END IF;

  IF v_tx.status = 'failed' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Transaction was previously marked failed.');
  END IF;

  IF p_amount_naira IS NULL OR p_amount_naira <> v_tx.amount THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount mismatch.');
  END IF;

  IF v_tx.product_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Missing product on transaction.');
  END IF;

  v_need := GREATEST(COALESCE(v_tx.quantity, 1), 1);

  SELECT COUNT(*)::INTEGER INTO v_available
  FROM public.log_items
  WHERE product_id = v_tx.product_id
    AND is_delivered = FALSE;

  IF v_available < v_need THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient undelivered inventory.');
  END IF;

  FOR v_i IN 1..v_need LOOP
    SELECT * INTO v_log
    FROM public.log_items
    WHERE product_id = v_tx.product_id
      AND is_delivered = FALSE
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Out of stock at fulfillment.');
    END IF;

    UPDATE public.log_items
    SET is_delivered = TRUE
    WHERE id = v_log.id;

    v_creds := v_creds || jsonb_build_array(v_log.credentials);

    UPDATE public.products
    SET
      stock  = stock - 1,
      status = CASE WHEN stock - 1 <= 0 THEN 'sold_out' ELSE 'available' END
    WHERE id = v_tx.product_id;
  END LOOP;

  UPDATE public.transactions
  SET
    status = 'completed',
    amount = p_amount_naira,
    log_id = v_log.id,
    credentials_delivered = v_creds
  WHERE reference = p_reference;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Purchase fulfilled.',
    'user_id', v_tx.user_id,
    'reference', p_reference
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;
