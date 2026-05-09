-- Clean up redundant triggers to prevent double-crediting
-- These triggers are reported to cause redundant balance updates when Next.js also processes the transaction.
-- We prefer letting the primary 'trg_apply_wallet_credit_from_transaction' handle the math.

-- Ensure the safety column exists
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS balance_credited boolean NOT NULL DEFAULT false;


DROP TRIGGER IF EXISTS on_transaction_completed ON public.transactions;
DROP TRIGGER IF EXISTS tr_update_wallet_on_success ON public.transactions;
DROP TRIGGER IF EXISTS trg_apply_wallet_credit_from_transaction_v2 ON public.transactions;

-- Ensure trg_apply_wallet_credit_from_transaction exists and is robust (it was defined in 016_wallet_credit_guardrails.sql)
-- We'll recreate it here just to be sure it's the canonical one and that it handles the 'balance_credited' flag correctly to prevent double-dipping.

CREATE OR REPLACE FUNCTION public.apply_wallet_credit_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_status text := CASE WHEN TG_OP = 'INSERT' THEN '' ELSE lower(coalesce(OLD.status, '')) END;
  new_status text := lower(coalesce(NEW.status, ''));
  tx_type text := lower(coalesce(NEW.type, ''));
  credit_amount numeric := coalesce(NEW.amount, 0);
  is_already_credited boolean := CASE WHEN TG_OP = 'INSERT' THEN false ELSE coalesce(OLD.balance_credited, false) END;
BEGIN
  -- Only process deposits/topups
  IF tx_type NOT IN ('deposit', 'wallet_topup') THEN
    RETURN NEW;
  END IF;

  -- Prevent double crediting if balance_credited is already true (on update)
  IF is_already_credited THEN
    RETURN NEW;
  END IF;

  -- Credit only once when status moves from non-success -> success.
  -- On INSERT, old_status is '' which is NOT in the success list.
  IF (new_status IN ('completed', 'success', 'finalized', 'successful'))
     AND (old_status NOT IN ('completed', 'success', 'finalized', 'successful')) THEN
    
    IF NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'Deposit transaction % has no user_id', NEW.id;
    END IF;

    IF credit_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit transaction % has invalid amount: %', NEW.id, credit_amount;
    END IF;

    -- Update balance
    UPDATE public.profiles
    SET wallet_balance = coalesce(wallet_balance, 0) + credit_amount
    WHERE id = NEW.user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No profile found for user_id % (transaction %)', NEW.user_id, NEW.id;
    END IF;

    -- Mark as credited to prevent any other logic from double-dipping
    NEW.balance_credited := true;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-attach trigger to handle both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_apply_wallet_credit_from_transaction ON public.transactions;
CREATE TRIGGER trg_apply_wallet_credit_from_transaction
BEFORE INSERT OR UPDATE OF status ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.apply_wallet_credit_from_transaction();

