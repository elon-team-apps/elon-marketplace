-- =============================================================================
-- Migration 041: Add flutterwave_enabled to payment_method_settings
-- Gives admin ability to turn Flutterwave on/off independently of PocketFi
-- =============================================================================

BEGIN;

-- Add the new column (default TRUE so existing deployments keep Flutterwave on)
ALTER TABLE public.payment_method_settings
  ADD COLUMN IF NOT EXISTS flutterwave_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Ensure the singleton row exists and set a sensible default
INSERT INTO public.payment_method_settings (id, pocketfi_enabled, flutterwave_enabled, manual_enabled)
VALUES (1, TRUE, TRUE, FALSE)
ON CONFLICT (id) DO UPDATE
  SET flutterwave_enabled = COALESCE(public.payment_method_settings.flutterwave_enabled, TRUE);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
