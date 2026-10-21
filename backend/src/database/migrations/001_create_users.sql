-- ============================================================================
-- Migration 001: Create Users Table
-- Description: Core users table linked to Supabase auth.users via user_id FK.
-- Includes RLS policies and an auto-updating updated_at trigger.
-- ============================================================================

-- Users table (linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    username VARCHAR(100),
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'manager', 'supervisor', 'agent')),
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT true,
    manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table comment
COMMENT ON TABLE public.users IS 'Application user profiles linked to Supabase Auth';
COMMENT ON COLUMN public.users.user_id IS 'References auth.users(id) — the Supabase Auth UUID';
COMMENT ON COLUMN public.users.role IS 'RBAC role: admin, manager, supervisor, or agent';
COMMENT ON COLUMN public.users.manager_id IS 'Hierarchical manager reference for org structure';

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Service role bypass: allows the backend service key to perform all operations
CREATE POLICY "Service role has full access" ON public.users
    FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON public.users
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================================================
-- Trigger: auto-update updated_at on row modification
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
