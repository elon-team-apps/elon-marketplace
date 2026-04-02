-- =============================================================================
-- Elon Marketplace — Migration 002: Deposit Processing
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================


-- =============================================================================
-- SECTION 1: process_deposit()
--
-- Called exclusively by the pocketfi-webhook Edge Function (server-side,
-- using the service role key). Never called directly from the browser.
--
-- Idempotency guarantee: if PocketFi fires the same webhook twice for the
-- same payment (a real-world occurrence), the second call finds
-- status = 'completed' and returns early without double-crediting the wallet.
--
-- Race condition safety: SELECT ... FOR UPDATE prevents two concurrent
-- webhook deliveries from processing the same reference simultaneously.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_deposit(
  p_reference TEXT,
  p_amount_naira INTEGER   -- amount in Naira (already converted from kobo by caller)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
BEGIN
  -- 1. Find and lock the pending deposit row
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE reference = p_reference
    AND type      = 'deposit'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Reference doesn't exist in our DB — could be a replay attack or
    -- a webhook for a transaction we never initiated. Reject it.
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Reference not found.'
    );
  END IF;

  -- 2. Idempotency check — already processed, return success silently
  --    so PocketFi stops retrying (they expect a 200 on success).
  IF v_tx.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Already processed.',
      'idempotent', true
    );
  END IF;

  IF v_tx.status = 'failed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Transaction was previously marked failed.'
    );
  END IF;

  -- 3. Mark the transaction as completed with the confirmed amount
  UPDATE public.transactions
  SET
    status = 'completed',
    amount = p_amount_naira
  WHERE reference = p_reference;

  -- 4. Credit the user's wallet atomically with the transaction update
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount_naira
  WHERE id = v_tx.user_id;

  RETURN jsonb_build_object(
    'success',  true,
    'message',  'Wallet credited.',
    'user_id',  v_tx.user_id,
    'amount',   p_amount_naira
  );

EXCEPTION WHEN OTHERS THEN
  -- Roll back and report — the Edge Function will return 500 so PocketFi retries
  RETURN jsonb_build_object(
    'success', false,
    'message', SQLERRM
  );
END;
$$;

-- Edge Function uses service role, so grant is to postgres role.
-- authenticated role must NOT be able to call this directly.
GRANT EXECUTE ON FUNCTION public.process_deposit(TEXT, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.process_deposit(TEXT, INTEGER) FROM authenticated, anon;


-- =============================================================================
-- SECTION 2: RLS policy for deposits
-- Users must be able to INSERT a pending deposit row when they initiate
-- a payment (before they leave for PocketFi checkout).
-- They should NOT be able to set status = 'completed' themselves.
-- =============================================================================

-- Allow authenticated users to insert their own pending deposit
CREATE POLICY "transactions: owner insert deposit"
  ON public.transactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND type   = 'deposit'
    AND status = 'pending'   -- client can only create pending rows
  );

-- Allow users to read their own transactions (already exists in migration 001,
-- kept here as a reminder — skip if already applied)
-- CREATE POLICY "transactions: owner read" ...


-- =============================================================================
-- SECTION 3: Helper view for the Admin analytics page
-- Gives a single query for total revenue, deposits, and purchases.
-- =============================================================================

CREATE OR REPLACE VIEW public.transaction_summary AS
SELECT
  type,
  status,
  COUNT(*)                    AS count,
  COALESCE(SUM(amount), 0)    AS total_naira
FROM public.transactions
GROUP BY type, status;

GRANT SELECT ON public.transaction_summary TO authenticated;
