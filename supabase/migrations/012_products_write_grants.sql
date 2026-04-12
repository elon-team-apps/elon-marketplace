-- Authenticated clients need table-level INSERT/UPDATE/DELETE on `products` so RLS policies
-- (`products: admin insert` / update / delete using `is_admin()`) can take effect.
-- Without these grants, PostgREST returns "permission denied" even for admins.

GRANT INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;
