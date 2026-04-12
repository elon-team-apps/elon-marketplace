-- Split credentials into email / password / recovery on log_items, keep `credentials` as full line.
-- Keep products.stock_count in sync with products.stock (UI reads stock_count first).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_count INTEGER;

UPDATE public.products
SET stock_count = stock
WHERE stock_count IS NULL;

CREATE OR REPLACE FUNCTION public.products_keep_stock_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.stock_count := NEW.stock;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_keep_stock_count ON public.products;
CREATE TRIGGER trg_products_keep_stock_count
  BEFORE INSERT OR UPDATE OF stock ON public.products
  FOR EACH ROW
  EXECUTE PROCEDURE public.products_keep_stock_count();

-- log_items: optional structured fields (defaults for existing rows)
ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS password TEXT NOT NULL DEFAULT '';

ALTER TABLE public.log_items
  ADD COLUMN IF NOT EXISTS recovery TEXT NOT NULL DEFAULT '';

UPDATE public.log_items li
SET
  email = COALESCE(NULLIF(trim((string_to_array(li.credentials, ':'))[1]), ''), ''),
  password = COALESCE(NULLIF(trim((string_to_array(li.credentials, ':'))[2]), ''), ''),
  recovery = COALESCE(
    NULLIF(
      trim(
        array_to_string(
          (string_to_array(li.credentials, ':'))[
            3 : array_length(string_to_array(li.credentials, ':'), 1)
          ],
          ':'
        )
      ),
      ''
    ),
    ''
  )
WHERE array_length(string_to_array(li.credentials, ':'), 1) >= 3;

-- bulk_upload_logs: parse each line → email, password, recovery + credentials; then sync stock
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
  v_inserted  INTEGER := 0;
  v_new_stock INTEGER;
  cred        TEXT;
  parts      TEXT[];
  em         TEXT;
  pw         TEXT;
  rec        TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('success', false, 'message', 'Forbidden: admin only.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  FOREACH cred IN ARRAY p_credentials LOOP
    cred := trim(cred);
    IF cred = '' THEN
      CONTINUE;
    END IF;

    parts := string_to_array(cred, ':');
    IF array_length(parts, 1) IS NULL OR array_length(parts, 1) < 3 THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Each line must be Email:Password:Recovery (at least two colons).'
      );
    END IF;

    em := trim(parts[1]);
    pw := trim(parts[2]);
    rec := trim(array_to_string(parts[3:array_length(parts, 1)], ':'));

    IF em = '' OR pw = '' THEN
      RETURN jsonb_build_object(
        'success', false,
        'message', 'Email and password cannot be empty (first two fields).'
      );
    END IF;

    INSERT INTO public.log_items (product_id, credentials, email, password, recovery)
    VALUES (p_product_id, cred, em, pw, rec);

    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'No valid log lines found.');
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_new_stock
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
