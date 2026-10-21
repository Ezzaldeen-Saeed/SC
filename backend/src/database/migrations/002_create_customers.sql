-- ============================================================================
-- Migration 002: Create Customers Table
-- Description: Customer records owned by users, with contact information.
-- Includes RLS policies and an auto-updating updated_at trigger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customers (
    id BIGSERIAL PRIMARY KEY,
    customer_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20),
    email VARCHAR(255),
    company VARCHAR(255),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table and column comments
COMMENT ON TABLE public.customers IS 'Customer contact records managed by agents';
COMMENT ON COLUMN public.customers.customer_id IS 'Public-facing UUID for API references';
COMMENT ON COLUMN public.customers.user_id IS 'The user (agent) who owns this customer record';

-- Enable Row Level Security
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "Service role has full access" ON public.customers
    FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own customers
CREATE POLICY "Users can read own customers" ON public.customers
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own customers
CREATE POLICY "Users can insert own customers" ON public.customers
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own customers
CREATE POLICY "Users can update own customers" ON public.customers
    FOR UPDATE USING (auth.uid() = user_id);

-- Auto-update updated_at trigger (reuses function from 001)
CREATE TRIGGER customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
