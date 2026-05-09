-- Migration: Enable required extensions for cryptographic functions
-- This ensures gen_random_bytes and uuid_generate_v4 are available.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Re-verify process_wallet_purchase has access to these functions
-- (Sometimes extensions are in a different schema, but typically they are in public)
