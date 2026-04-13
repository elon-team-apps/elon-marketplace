-- =============================================================================
-- log_items.status + bulk_upload_logs(JSON array of {email,password,recovery})
-- Aligns RPC with app: p_logs JSONB = [{ "email", "password", "recovery" }, ...]
-- Stock for catalogue is kept in sync from COUNT(*) WHERE status = 'available'.
-- =============================================================================

ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available';

-- Backfill from legacy delivery flag (column default is 'available' for new column)
UPDATE public.log_items
SET status = CASE WHEN is_delivered THEN 'delivered' ELSE 'available' END;

CREATE INDEX IF NOT EXISTS idx_log_items_product_status
  ON public.log_items (product_id, status);

-- Replace TEXT[] overload with JSONB payload (PostgREST single RPC name)
DROP FUNCTION IF EXISTS public.bulk_upload_logs(UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.bulk_upload_logs(
  p_product_id UUID,
  p_logs       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted   INTEGER := 0;
  v_new_stock  INTEGER;
  v_len        INTEGER;
  v_i          INTEGER;
  elem         JSONB;
  em           TEXT;
  pw           TEXT;
  rec          TEXT;
  cred         TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Forbidden: admin only.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'p_logs must be a JSON array of objects with email, password, and optional recovery.'
    );
  END IF;

  v_len := jsonb_array_length(COALESCE(p_logs, '[]'::jsonb));
  FOR v_i IN 0..(v_len - 1) LOOP
    elem := p_logs->v_i;
    IF jsonb_typeof(elem) <> 'object' THEN
      CONTINUE;
    END IF;

    em := NULLIF(btrim(COALESCE(elem->>'email', '')), '');
    pw := NULLIF(btrim(COALESCE(elem->>'password', '')), '');
    rec := NULLIF(btrim(COALESCE(elem->>'recovery', '')), '');

    IF em IS NULL OR pw IS NULL THEN
      CONTINUE;
    END IF;

    IF rec IS NULL OR rec = '' THEN
      rec := '-';
    END IF;

    cred := em || ':' || pw || ':' || rec;

    INSERT INTO public.log_items (product_id, credentials, email, password, recovery, status, is_delivered)
    VALUES (p_product_id, cred, em, pw, rec, 'available', FALSE);

    v_inserted := v_inserted + 1;
  END LOOP;

  SELECT COUNT(*)::INTEGER INTO v_new_stock
  FROM public.log_items
  WHERE product_id = p_product_id
    AND status = 'available';

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

GRANT EXECUTE ON FUNCTION public.bulk_upload_logs(UUID, JSONB) TO authenticated;

-- purchase_log: claim only available rows; mark delivered + status
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
    AND status = 'available'
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
  SET
    is_delivered = TRUE,
    status       = 'delivered'
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

-- fulfill_paystack_purchase: same availability semantics
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
    AND is_delivered = FALSE
    AND status = 'available';

  IF v_available < v_need THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient undelivered inventory.');
  END IF;

  FOR v_i IN 1..v_need LOOP
    SELECT * INTO v_log
    FROM public.log_items
    WHERE product_id = v_tx.product_id
      AND is_delivered = FALSE
      AND status = 'available'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Out of stock at fulfillment.');
    END IF;

    UPDATE public.log_items
    SET
      is_delivered = TRUE,
      status       = 'delivered'
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
