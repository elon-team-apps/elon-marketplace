-- =============================================================================
-- Migration: 045_admin_analytics_rpc.sql
-- Creates get_admin_analytics() RPC for accurate revenue + logs sold counts.
-- Revenue  = SUM(amount) on completed PURCHASE transactions only (not deposits)
-- LogsSold = COUNT(*) on log_items WHERE is_delivered = TRUE
--            (ground truth — not relying on transactions.quantity which can be NULL)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revenue    NUMERIC := 0;
  v_logs_sold  BIGINT  := 0;
  v_total_users BIGINT := 0;
  v_new_today  BIGINT := 0;
  v_today_start TIMESTAMPTZ;
BEGIN
  -- Admin guard
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error', 'Forbidden: admin only.');
  END IF;

  v_today_start := date_trunc('day', NOW() AT TIME ZONE 'UTC');

  -- Accurate revenue: only completed purchase transactions
  SELECT COALESCE(SUM(t.amount), 0)
    INTO v_revenue
    FROM public.transactions t
   WHERE t.status = 'completed'
     AND t.type   = 'purchase';

  -- Accurate logs sold: delivered log_items is the ground truth
  SELECT COUNT(*)
    INTO v_logs_sold
    FROM public.log_items li
   WHERE li.is_delivered = TRUE
      OR li.status IN ('sold', 'delivered');

  -- Total registered users
  SELECT COUNT(*) INTO v_total_users FROM public.profiles;

  -- New users today (UTC day boundary)
  SELECT COUNT(*)
    INTO v_new_today
    FROM public.profiles
   WHERE created_at >= v_today_start;

  RETURN jsonb_build_object(
    'revenue',     v_revenue,
    'logs_sold',   v_logs_sold,
    'total_users', v_total_users,
    'new_today',   v_new_today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_analytics() TO authenticated;
