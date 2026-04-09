-- Paystack webhook: pending purchase rows + fulfillment (no wallet debit).
-- quantity: number of log rows to deliver for a single Paystack charge.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 50);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credentials_delivered JSONB;

COMMENT ON COLUMN public.transactions.credentials_delivered IS 'JSON array of credential strings delivered via Paystack webhook (multi-qty purchases).';

-- =============================================================================
-- fulfill_paystack_purchase — called by pocketfi-webhook (service role)
-- Preconditions: pending purchase row with Paystack reference, amount matches.
-- =============================================================================

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
  v_log        public.logs_data%ROWTYPE;
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
  FROM public.logs_data
  WHERE product_id = v_tx.product_id
    AND is_delivered = FALSE;

  IF v_available < v_need THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient undelivered inventory.');
  END IF;

  FOR v_i IN 1..v_need LOOP
    SELECT * INTO v_log
    FROM public.logs_data
    WHERE product_id = v_tx.product_id
      AND is_delivered = FALSE
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'message', 'Out of stock at fulfillment.');
    END IF;

    UPDATE public.logs_data
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
  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_paystack_purchase(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_paystack_purchase(TEXT, INTEGER) TO service_role;
