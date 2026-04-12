-- Boolean admin flag on profiles (app checks `is_admin`; RLS uses `public.is_admin()`).
-- Existing admins by `role = 'admin'` are migrated onto the flag for one source of truth.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE public.profiles
SET is_admin = true
WHERE LOWER(COALESCE(role, '')) = 'admin';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        COALESCE(p.is_admin, false) = true
        OR LOWER(COALESCE(p.role, '')) = 'admin'
      )
  );
$$;
