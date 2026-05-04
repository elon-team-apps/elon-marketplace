-- Migration: Setup storage policies for product-logos bucket
-- This allows public read access and restricted admin write access.

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-logos', 'product-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing generic or specific policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Admin Upload" ON storage.objects;
DROP POLICY IF EXISTS "Admin Update" ON storage.objects;
DROP POLICY IF EXISTS "Admin Delete" ON storage.objects;
DROP POLICY IF EXISTS "product-logos_public_access" ON storage.objects;
DROP POLICY IF EXISTS "product-logos_admin_upload" ON storage.objects;
DROP POLICY IF EXISTS "product-logos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "product-logos_admin_delete" ON storage.objects;

-- Allow public access to read logos
CREATE POLICY "product-logos_public_access" ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-logos');

-- Allow admins to upload logos
CREATE POLICY "product-logos_admin_upload" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );

-- Allow admins to update logos
CREATE POLICY "product-logos_admin_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );

-- Allow admins to delete logos
CREATE POLICY "product-logos_admin_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-logos'
    AND public.is_admin()
  );
