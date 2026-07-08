-- Add account_url to products table
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS account_url TEXT;

-- Update the schema cache just in case
NOTIFY pgrst, 'reload schema';
