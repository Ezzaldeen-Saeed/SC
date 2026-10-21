-- ============================================================================
-- Migration 004: Create Audit Logs Table
-- Description: Immutable audit trail for compliance and traceability.
-- Records all significant write operations performed by users.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table and column comments
COMMENT ON TABLE public.audit_logs IS 'Immutable audit trail for all significant operations';
COMMENT ON COLUMN public.audit_logs.action IS 'The action performed (e.g., CREATE, UPDATE, DELETE, LOGIN)';
COMMENT ON COLUMN public.audit_logs.resource IS 'The resource type affected (e.g., users, calls, customers)';
COMMENT ON COLUMN public.audit_logs.resource_id IS 'The specific resource identifier acted upon';
COMMENT ON COLUMN public.audit_logs.details IS 'Additional context (request body, params, changes)';

-- Enable Row Level Security
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypass: only the backend can read/write audit logs
CREATE POLICY "Service role has full access" ON public.audit_logs
    FOR ALL USING (auth.role() = 'service_role');

-- Admins can read audit logs (read-only)
CREATE POLICY "Admins can read audit logs" ON public.audit_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.user_id = auth.uid()
              AND users.role = 'admin'
        )
    );

-- Prevent updates and deletes on audit logs (immutable)
-- This is enforced at the application level and via RLS (no UPDATE/DELETE policies)
