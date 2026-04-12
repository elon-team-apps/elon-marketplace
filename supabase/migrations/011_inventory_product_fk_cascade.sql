-- Ensure inventory rows are removed when a product is deleted (DB-level CASCADE).
-- App code also deletes log_items first; this migration makes the FK authoritative.

DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.log_items') IS NOT NULL THEN
    FOR r IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'log_items'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'product_id'
    LOOP
      EXECUTE format('ALTER TABLE public.log_items DROP CONSTRAINT IF EXISTS %I', r.constraint_name);
    END LOOP;

    ALTER TABLE public.log_items
      ADD CONSTRAINT log_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Legacy table name (skipped automatically if rename migration 009 already ran).
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.logs_data') IS NOT NULL THEN
    FOR r IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'logs_data'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'product_id'
    LOOP
      EXECUTE format('ALTER TABLE public.logs_data DROP CONSTRAINT IF EXISTS %I', r.constraint_name);
    END LOOP;

    ALTER TABLE public.logs_data
      ADD CONSTRAINT logs_data_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
  END IF;
END $$;
