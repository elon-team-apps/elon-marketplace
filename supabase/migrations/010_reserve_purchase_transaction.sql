-- Reserve a pending Paystack purchase row as the authenticated user (bypasses RLS safely).
-- PurchaseModal calls this after pocketfi-init returns a Paystack reference.

CREATE OR REPLACE FUNCTION public.reserve_purchase_transaction(
  p_reference   TEXT,
  p_amount      INTEGER,
  p_product_id  UUID,
  p_quantity      INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'message', 'No profile row for this user (profiles.id must match auth.uid()).');
  END IF;

  IF p_reference IS NULL OR trim(p_reference) = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Missing Paystack reference.');
  END IF;

  IF p_amount IS NULL OR p_amount < 1 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid amount.');
  END IF;

  IF p_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  v_qty := GREATEST(1, LEAST(COALESCE(NULLIF(p_quantity, 0), 1), 50));

  INSERT INTO public.transactions (
    user_id,
    amount,
    type,
    status,
    reference,
    product_id,
    quantity
  )
  VALUES (
    auth.uid(),
    p_amount,
    'purchase',
    'pending',
    trim(p_reference),
    p_product_id,
    v_qty
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'A transaction with this Paystack reference already exists (duplicate or retry).',
      'code', 'unique_violation'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', SQLERRM,
      'sqlstate', SQLSTATE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_purchase_transaction(TEXT, INTEGER, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_purchase_transaction(TEXT, INTEGER, UUID, INTEGER) TO authenticated;
