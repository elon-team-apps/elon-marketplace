-- =============================================================================
-- Migration 006: Admin-controlled payment method toggles
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_method_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1,
  pocketfi_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  manual_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_method_settings_singleton CHECK (id = 1)
);

INSERT INTO public.payment_method_settings (id, pocketfi_enabled, manual_enabled)
VALUES (1, TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_method_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_settings_read_all"
  ON public.payment_method_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "payment_settings_admin_update"
  ON public.payment_method_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

GRANT SELECT, UPDATE ON public.payment_method_settings TO authenticated;
