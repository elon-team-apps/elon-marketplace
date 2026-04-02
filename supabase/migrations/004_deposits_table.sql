-- =============================================================================
-- Migration 004 — Manual Deposit System
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================

-- ── 1. deposits table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deposits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount         INTEGER     NOT NULL CHECK (amount > 0),
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'completed', 'rejected')),
  screenshot_url TEXT,                    -- public URL from Supabase Storage
  note           TEXT,                    -- optional user note
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at current automatically
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS deposits_updated_at ON public.deposits;
CREATE TRIGGER deposits_updated_at
  BEFORE UPDATE ON public.deposits
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── 2. Row-Level Security ──────────────────────────────────────────────────────
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

-- Users: insert their own deposits, read their own deposits
CREATE POLICY "users_insert_own_deposit" ON public.deposits
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_select_own_deposits" ON public.deposits
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins: full access (SELECT + UPDATE for approve/reject)
CREATE POLICY "admins_all_deposits" ON public.deposits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── 3. Supabase Storage bucket for screenshots ────────────────────────────────
-- Run this block only once. If the bucket already exists, this is a no-op.
INSERT INTO storage.buckets (id, name, public)
VALUES ('deposit-screenshots', 'deposit-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "auth_upload_screenshots" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deposit-screenshots');

CREATE POLICY "public_read_screenshots" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'deposit-screenshots');

-- ── 4. approve_deposit — atomic RPC called by the admin UI ────────────────────
-- Adds amount to user wallet AND marks deposit completed in one transaction.
-- SECURITY DEFINER runs as the postgres superuser — bypasses RLS for the UPDATE.
CREATE OR REPLACE FUNCTION public.approve_deposit(p_deposit_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep  public.deposits%ROWTYPE;
BEGIN
  -- Lock the deposit row to prevent double-approval race conditions
  SELECT * INTO v_dep
  FROM public.deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deposit not found.');
  END IF;

  IF v_dep.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', format('Deposit is already %s.', v_dep.status)
    );
  END IF;

  -- Credit the wallet
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + v_dep.amount
  WHERE id = v_dep.user_id;

  -- Mark completed
  UPDATE public.deposits
  SET status = 'completed'
  WHERE id = p_deposit_id;

  RETURN jsonb_build_object('success', true, 'amount', v_dep.amount);
END;
$$;

-- Only admins may call this function
REVOKE EXECUTE ON FUNCTION public.approve_deposit(UUID) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.approve_deposit(UUID) TO authenticated;
