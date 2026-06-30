-- Migration: Update bulk_upload_logs to preserve exact formatting from admin input
-- Allows logs without strict email:password formatting to be stored and delivered exactly as pasted.

BEGIN;

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
  raw_content  TEXT;
  cred         TEXT;
  v_has_content_col BOOLEAN;
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
      'message', 'p_logs must be a JSON array.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'log_items' AND column_name = 'content'
  ) INTO v_has_content_col;

  v_len := jsonb_array_length(COALESCE(p_logs, '[]'::jsonb));
  FOR v_i IN 0..(v_len - 1) LOOP
    elem := p_logs->v_i;
    IF jsonb_typeof(elem) <> 'object' THEN
      CONTINUE;
    END IF;

    raw_content := NULLIF(btrim(COALESCE(elem->>'content', '')), '');
    em := NULLIF(btrim(COALESCE(elem->>'email', '')), '');
    pw := NULLIF(btrim(COALESCE(elem->>'password', '')), '');
    rec := NULLIF(btrim(COALESCE(elem->>'recovery', '')), '');

    IF raw_content IS NULL AND em IS NULL AND pw IS NULL THEN
      CONTINUE;
    END IF;

    -- If raw content is provided, save it as credentials to preserve exact format.
    -- Otherwise build from parts.
    IF raw_content IS NOT NULL THEN
      cred := raw_content;
    ELSE
      IF rec IS NULL OR rec = '' THEN
        rec := '-';
      END IF;
      cred := COALESCE(em, '') || ':' || COALESCE(pw, '') || ':' || rec;
    END IF;

    IF v_has_content_col THEN
      INSERT INTO public.log_items (product_id, credentials, content, email, password, recovery, status, is_delivered)
      VALUES (p_product_id, cred, raw_content, em, pw, rec, 'available', FALSE);
    ELSE
      INSERT INTO public.log_items (product_id, credentials, email, password, recovery, status, is_delivered)
      VALUES (p_product_id, cred, em, pw, rec, 'available', FALSE);
    END IF;

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

COMMIT;
