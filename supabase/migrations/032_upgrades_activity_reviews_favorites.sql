-- 1. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for Activity Logs
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view activity logs" ON activity_logs;
CREATE POLICY "Admins can view activity logs" ON activity_logs FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Trigger function to log new deposits
CREATE OR REPLACE FUNCTION log_deposit_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        INSERT INTO activity_logs (user_id, action_type, description, metadata)
        VALUES (
            NEW.user_id, 
            'wallet_deposit', 
            'User deposited funds into wallet.', 
            jsonb_build_object('amount', NEW.amount, 'deposit_id', NEW.id, 'method', NEW.payment_method)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger for Deposits
DROP TRIGGER IF EXISTS on_deposit_approved ON deposits;
CREATE TRIGGER on_deposit_approved
    AFTER UPDATE ON deposits
    FOR EACH ROW
    EXECUTE FUNCTION log_deposit_activity();

-- 2. Product Reviews Table
CREATE TABLE IF NOT EXISTS product_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_id, user_id)
);

-- RLS for Reviews
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read reviews" ON product_reviews;
CREATE POLICY "Anyone can read reviews" ON product_reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users can create reviews" ON product_reviews;
CREATE POLICY "Users can create reviews" ON product_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own reviews" ON product_reviews;
CREATE POLICY "Users can update own reviews" ON product_reviews FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own reviews" ON product_reviews;
CREATE POLICY "Users can delete own reviews" ON product_reviews FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can delete any review" ON product_reviews;
CREATE POLICY "Admins can delete any review" ON product_reviews FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 3. Favorites / Wishlist Table
CREATE TABLE IF NOT EXISTS user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- RLS for Favorites
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage favorites" ON user_favorites;
CREATE POLICY "Users can manage favorites" ON user_favorites FOR ALL USING (auth.uid() = user_id);

-- Expose tables in publication for realtime
ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
