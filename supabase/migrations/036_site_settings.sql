-- Migration: Create site_settings table for global configurations (e.g. announcements)

BEGIN;

CREATE TABLE IF NOT EXISTS public.site_settings (
  id BIGINT PRIMARY KEY,
  announcement_message TEXT,
  announcement_active BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT site_settings_singleton CHECK (id = 1)
);

INSERT INTO public.site_settings (id, announcement_message, announcement_active) 
VALUES (1, '', false) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view site_settings"
  ON public.site_settings FOR SELECT USING (true);

CREATE POLICY "Admins can update site_settings"
  ON public.site_settings FOR UPDATE USING (public.is_admin());

GRANT SELECT, UPDATE ON public.site_settings TO authenticated;
GRANT SELECT ON public.site_settings TO anon;

COMMIT;
