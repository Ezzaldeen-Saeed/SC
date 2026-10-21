-- ============================================================================
-- Migration 005: Create Performance Indexes
-- Description: Indexes to optimize common query patterns across all core tables.
-- ============================================================================

-- ============================================================================
-- Users indexes
-- ============================================================================

-- Lookup by role (e.g., list all agents, list all managers)
CREATE INDEX IF NOT EXISTS idx_users_role
    ON public.users (role);

-- Lookup by manager_id (e.g., find all agents under a manager)
CREATE INDEX IF NOT EXISTS idx_users_manager_id
    ON public.users (manager_id)
    WHERE manager_id IS NOT NULL;

-- Filter by active status
CREATE INDEX IF NOT EXISTS idx_users_is_active
    ON public.users (is_active);

-- Lookup by email (login, profile queries)
CREATE INDEX IF NOT EXISTS idx_users_email
    ON public.users (email);

-- Composite: active users by role (common dashboard query)
CREATE INDEX IF NOT EXISTS idx_users_role_active
    ON public.users (role, is_active)
    WHERE is_active = true;

-- ============================================================================
-- Calls indexes
-- ============================================================================

-- Lookup by user_id (agent's call history)
CREATE INDEX IF NOT EXISTS idx_calls_user_id
    ON public.calls (user_id);

-- Lookup by call_start (time-range queries, recent calls)
CREATE INDEX IF NOT EXISTS idx_calls_call_start
    ON public.calls (call_start DESC);

-- Lookup by customer_id (customer call history)
CREATE INDEX IF NOT EXISTS idx_calls_customer_id
    ON public.calls (customer_id)
    WHERE customer_id IS NOT NULL;

-- Composite: user's calls ordered by time (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_calls_user_id_call_start
    ON public.calls (user_id, call_start DESC);

-- Filter by status
CREATE INDEX IF NOT EXISTS idx_calls_status
    ON public.calls (status);

-- Filter by sentiment (analytics)
CREATE INDEX IF NOT EXISTS idx_calls_sentiment
    ON public.calls (sentiment)
    WHERE sentiment IS NOT NULL;

-- ============================================================================
-- Customers indexes
-- ============================================================================

-- Lookup by user_id (agent's customers)
CREATE INDEX IF NOT EXISTS idx_customers_user_id
    ON public.customers (user_id);

-- Search by phone_number (caller ID lookup)
CREATE INDEX IF NOT EXISTS idx_customers_phone_number
    ON public.customers (phone_number)
    WHERE phone_number IS NOT NULL;

-- Search by email
CREATE INDEX IF NOT EXISTS idx_customers_email
    ON public.customers (email)
    WHERE email IS NOT NULL;

-- ============================================================================
-- Audit logs indexes
-- ============================================================================

-- Lookup by user_id (user activity history)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
    ON public.audit_logs (user_id)
    WHERE user_id IS NOT NULL;

-- Lookup by created_at (time-range queries, recent activity)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON public.audit_logs (created_at DESC);

-- Lookup by action (e.g., find all DELETEs)
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON public.audit_logs (action);

-- Composite: user activity over time (common audit query)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_created_at
    ON public.audit_logs (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Composite: resource-specific audit trail
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_resource_id
    ON public.audit_logs (resource, resource_id)
    WHERE resource_id IS NOT NULL;
