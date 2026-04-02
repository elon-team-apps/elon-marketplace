-- =============================================================================
-- Elon Marketplace — Migration 003: Bulk Log Upload Function
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================

-- -----------------------------------------------------------------------------
-- bulk_upload_logs
-- Admin-only function. Inserts an array of credential strings into logs_data
-- for the given product, then recalculates and syncs the product's stock count
-- from the actual number of undelivered rows — so stock is always accurate.
--
-- Called from the Admin Console "Bulk Upload" modal via supabase.rpc().
-- SECURITY DEFINER means it runs as the function owner and bypasses RLS for
-- its writes, but we manually gate it with is_admin() so no regular user
-- can call it.
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
  -- ── 1. Admin gate ──────────────────────────────────────────────────────────
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Forbidden: admin only.');
  END IF;

  -- ── 2. Verify product exists ───────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  -- ── 3. Bulk insert — skip blank lines ─────────────────────────────────────
  INSERT INTO public.logs_data (product_id, credentials)
  SELECT p_product_id, cred
  FROM unnest(p_credentials) AS cred
  WHERE trim(cred) <> '';

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'No valid log lines found.');
  END IF;

  -- ── 4. Recalculate stock from undelivered rows ─────────────────────────────
  -- Count-based sync is always accurate regardless of prior manual edits.
  SELECT COUNT(*) INTO v_new_stock
  FROM public.logs_data
  WHERE product_id = p_product_id
    AND is_delivered = FALSE;

  -- ── 5. Sync product stock + status ────────────────────────────────────────
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
  RETURN jsonb_build_object('success', false, 'message', 'Upload failed. Please try again.');
END;
$$;

-- Allow authenticated users to call the function.
-- RLS is enforced inside the function body via is_admin().
GRANT EXECUTE ON FUNCTION public.bulk_upload_logs(UUID, TEXT[]) TO authenticated;
