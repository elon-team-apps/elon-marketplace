-- Migration: Setup storage policies for product-logos bucket
-- This allows public read access and restricted admin write access.

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-logos', 'product-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Admin Upload" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete" ON storage.objects;

-- Allow public access to read logos
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-logos');

-- Allow admins to upload logos
CREATE POLICY "Admin Upload" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );

-- Allow admins to update logos
CREATE POLICY "Admin Update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );

-- Allow admins to delete logos
CREATE POLICY "Admin Delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );
