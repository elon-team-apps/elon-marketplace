-- =============================================================================
-- Elon Marketplace — Initial Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================


-- =============================================================================
-- SECTION 1: TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- Extends Supabase's built-in auth.users. One row per user, created
-- automatically via the trigger below when someone signs up.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL DEFAULT '',
  email            TEXT        NOT NULL DEFAULT '',
  wallet_balance   INTEGER     NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  role             TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- products
-- Public-facing catalogue. preview_data holds safe metadata (follower count,
-- account age, etc.) that users can see BEFORE buying.
-- Actual credentials live in logs_data only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  category         TEXT        NOT NULL,
  price            INTEGER     NOT NULL CHECK (price > 0),
  description      TEXT,
  stock            INTEGER     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  status           TEXT        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold_out')),
  preview_data     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- logs_data
-- The secret table. Each row is ONE credential set tied to ONE product.
-- RLS on this table is the core security boundary of the entire platform.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.logs_data (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  credentials      TEXT        NOT NULL,   -- store as encrypted string; plaintext for Phase 1
  is_delivered     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- transactions
-- Immutable audit trail. Every wallet deposit AND every purchase is a row here.
-- The reference column stores the Paystack reference for idempotency —
-- a webhook that fires twice for the same payment will hit a UNIQUE violation
-- and be safely ignored rather than crediting the wallet twice.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount           INTEGER     NOT NULL CHECK (amount > 0),
  type             TEXT        NOT NULL CHECK (type IN ('deposit', 'purchase')),
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  product_id       UUID        REFERENCES public.products(id) ON DELETE SET NULL,
  log_id           UUID        REFERENCES public.logs_data(id) ON DELETE SET NULL,
  reference        TEXT        UNIQUE,     -- Paystack reference; NULL for manual deposits
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECTION 2: INDEXES
-- (Speed up the queries that run on every page load)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_logs_data_product_id    ON public.logs_data(product_id);
CREATE INDEX IF NOT EXISTS idx_logs_data_is_delivered  ON public.logs_data(is_delivered);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id    ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_product_id ON public.transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference  ON public.transactions(reference);
CREATE INDEX IF NOT EXISTS idx_products_category       ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_status         ON public.products(status);


-- =============================================================================
-- SECTION 3: AUTOMATIC PROFILE CREATION
-- Runs every time a new user signs up via Supabase Auth.
-- Copies their email into profiles so we have it in our own table.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- SECTION 4: PURCHASE FUNCTION
-- Atomic purchase executed in a single Postgres transaction.
-- Fixes the race condition from the TRD risk assessment: two simultaneous
-- buyers cannot receive the same log because SELECT ... FOR UPDATE locks
-- the chosen log row before the outer transaction can read it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.purchase_log(
  p_user_id    UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product     public.products%ROWTYPE;
  v_log         public.logs_data%ROWTYPE;
  v_balance     INTEGER;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  -- 1. Lock the product row to prevent concurrent over-selling
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Product not found.');
  END IF;

  IF v_product.stock = 0 OR v_product.status = 'sold_out' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Out of stock.');
  END IF;

  -- 2. Check buyer's balance
  SELECT wallet_balance INTO v_balance
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance < v_product.price THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', format('Insufficient balance. Need ₦%s more.',
                         (v_product.price - v_balance)::TEXT)
    );
  END IF;

  -- 3. Claim an undelivered log (FIFO — oldest first)
  SELECT * INTO v_log
  FROM public.logs_data
  WHERE product_id = p_product_id
    AND is_delivered = FALSE
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;   -- skip any row another concurrent tx is already claiming

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Out of stock.');
  END IF;

  -- 4. Deduct wallet
  UPDATE public.profiles
  SET wallet_balance = wallet_balance - v_product.price
  WHERE id = p_user_id;

  -- 5. Mark log as delivered
  UPDATE public.logs_data
  SET is_delivered = TRUE
  WHERE id = v_log.id;

  -- 6. Decrement product stock
  UPDATE public.products
  SET
    stock  = stock - 1,
    status = CASE WHEN stock - 1 = 0 THEN 'sold_out' ELSE 'available' END
  WHERE id = p_product_id;

  -- 7. Write the transaction record
  INSERT INTO public.transactions (user_id, amount, type, status, product_id, log_id)
  VALUES (p_user_id, v_product.price, 'purchase', 'completed', p_product_id, v_log.id)
  RETURNING * INTO v_transaction;

  -- 8. Return success + the credential (only time it is ever sent to the client)
  RETURN jsonb_build_object(
    'success',      true,
    'message',      'Purchase successful.',
    'log_id',       v_log.id,
    'credentials',  v_log.credentials,
    'transaction_id', v_transaction.id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', 'Purchase failed. Please try again.');
END;
$$;


-- =============================================================================
-- SECTION 5: ROW LEVEL SECURITY (RLS)
-- This is the security boundary of the platform.
-- =============================================================================

ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs_data    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Helper: returns true if the caller's profile has role = 'admin'
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


-- ── profiles ─────────────────────────────────────────────────────────────────

-- Users can read and update only their own row
CREATE POLICY "profiles: owner read"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: owner update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can read every profile (needed for Users & Wallets page)
CREATE POLICY "profiles: admin read all"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- Admins can update any profile (manual wallet adjustments)
CREATE POLICY "profiles: admin update all"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());


-- ── products ─────────────────────────────────────────────────────────────────

-- Every authenticated user (and anonymous visitors) can browse products
CREATE POLICY "products: public read"
  ON public.products FOR SELECT
  USING (true);

-- Only admins can create, update, or delete products
CREATE POLICY "products: admin insert"
  ON public.products FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "products: admin update"
  ON public.products FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "products: admin delete"
  ON public.products FOR DELETE
  USING (public.is_admin());


-- ── logs_data ─────────────────────────────────────────────────────────────────
-- THE CRITICAL POLICY
-- A user can read a log row ONLY IF there is a completed 'purchase' transaction
-- that links their user_id to that specific log_id.
-- No transaction = no access, regardless of anything else.

CREATE POLICY "logs_data: buyer read after purchase"
  ON public.logs_data FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.log_id    = logs_data.id
        AND t.user_id   = auth.uid()
        AND t.type      = 'purchase'
        AND t.status    = 'completed'
    )
  );

-- Admins can read all logs (for the Order Audit page)
CREATE POLICY "logs_data: admin read all"
  ON public.logs_data FOR SELECT
  USING (public.is_admin());

-- Only admins can insert logs (bulk upload from Product Manager)
CREATE POLICY "logs_data: admin insert"
  ON public.logs_data FOR INSERT
  WITH CHECK (public.is_admin());

-- Only admins can delete logs
CREATE POLICY "logs_data: admin delete"
  ON public.logs_data FOR DELETE
  USING (public.is_admin());


-- ── transactions ─────────────────────────────────────────────────────────────

-- Users can see only their own transactions
CREATE POLICY "transactions: owner read"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can see all transactions (Order Audit page)
CREATE POLICY "transactions: admin read all"
  ON public.transactions FOR SELECT
  USING (public.is_admin());

-- Transactions are created only by the purchase_log() function (SECURITY DEFINER)
-- or by a Paystack webhook (server-side). No client can insert directly.
-- We therefore grant insert to no role here. The function bypasses RLS.


-- =============================================================================
-- SECTION 6: GRANT PERMISSIONS TO AUTHENTICATED ROLE
-- =============================================================================

GRANT SELECT, UPDATE             ON public.profiles     TO authenticated;
GRANT SELECT                     ON public.products     TO authenticated;
GRANT SELECT                     ON public.logs_data    TO authenticated;
GRANT SELECT                     ON public.transactions TO authenticated;
-- purchase_log() is SECURITY DEFINER so it runs as the function owner (superuser)
-- and can write to all tables without needing direct client grants.
GRANT EXECUTE ON FUNCTION public.purchase_log(UUID, UUID) TO authenticated;
