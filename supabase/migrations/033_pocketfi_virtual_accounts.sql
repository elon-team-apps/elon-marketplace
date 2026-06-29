-- =============================================================================
-- Migration: Add PocketFi Virtual Account Fields to Profiles
-- =============================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS virtual_account_number TEXT,
ADD COLUMN IF NOT EXISTS virtual_account_bank TEXT,
ADD COLUMN IF NOT EXISTS virtual_account_name TEXT;

-- Create an index to quickly look up users by their virtual account number
CREATE INDEX IF NOT EXISTS idx_profiles_virtual_account_number 
ON public.profiles(virtual_account_number);
