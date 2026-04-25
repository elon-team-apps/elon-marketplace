CREATE TABLE IF NOT EXISTS public.webhook_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  tx_ref text NOT NULL,
  decision text NOT NULL,
  reason text,
  expected_amount numeric,
  verified_amount numeric,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_verifications_provider_tx_ref
  ON public.webhook_verifications(provider, tx_ref);

CREATE INDEX IF NOT EXISTS idx_webhook_verifications_created_at
  ON public.webhook_verifications(created_at DESC);

COMMENT ON TABLE public.webhook_verifications IS 'Audit trail for webhook verification decisions.';
COMMENT ON COLUMN public.webhook_verifications.decision IS 'accepted or rejected.';

GRANT INSERT, SELECT ON public.webhook_verifications TO service_role;
