-- Allow authenticated users to INSERT a pending purchase row before Paystack redirect
-- (mirrors "transactions: owner insert deposit"). Completed status is set by webhook/RPC only.

CREATE POLICY "transactions: owner insert purchase pending"
  ON public.transactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND type = 'purchase'
    AND status = 'pending'
  );
