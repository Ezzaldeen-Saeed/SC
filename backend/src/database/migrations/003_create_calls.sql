-- ============================================================================
-- Migration 003: Create Calls Table
-- Description: Call records with links to users and customers.
-- Includes call timing, outcome, sentiment analysis, transcript, and AI analysis.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calls (
    id BIGSERIAL PRIMARY KEY,
    call_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(customer_id) ON DELETE SET NULL,
    call_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    call_end TIMESTAMPTZ,
    duration INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN call_end IS NOT NULL
            THEN EXTRACT(EPOCH FROM (call_end - call_start))::INTEGER
            ELSE NULL
        END
    ) STORED,
    direction VARCHAR(10) NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound', 'outbound')),
    outcome VARCHAR(50) CHECK (outcome IN (
        'completed', 'no_answer', 'busy', 'voicemail',
        'callback_scheduled', 'wrong_number', 'disconnected'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN (
        'in_progress', 'completed', 'missed', 'failed'
    )),
    notes TEXT,
    sentiment VARCHAR(20) CHECK (sentiment IN (
        'very_positive', 'positive', 'neutral', 'negative', 'very_negative'
    )),
    sentiment_score DECIMAL(3, 2) CHECK (sentiment_score BETWEEN -1.00 AND 1.00),
    transcript TEXT,
    ai_analysis JSONB DEFAULT '{}'::jsonb,
    tags TEXT[] DEFAULT '{}',
    recording_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add table and column comments
COMMENT ON TABLE public.calls IS 'Call records with AI-powered analysis and sentiment scoring';
COMMENT ON COLUMN public.calls.call_id IS 'Public-facing UUID for API references';
COMMENT ON COLUMN public.calls.duration IS 'Auto-computed duration in seconds from call_start/call_end';
COMMENT ON COLUMN public.calls.ai_analysis IS 'JSON blob containing AI-generated insights (summary, keywords, action items)';
COMMENT ON COLUMN public.calls.sentiment_score IS 'Numeric sentiment score ranging from -1.00 (very negative) to 1.00 (very positive)';

-- Enable Row Level Security
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "Service role has full access" ON public.calls
    FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own calls
CREATE POLICY "Users can read own calls" ON public.calls
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own calls
CREATE POLICY "Users can insert own calls" ON public.calls
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own calls
CREATE POLICY "Users can update own calls" ON public.calls
    FOR UPDATE USING (auth.uid() = user_id);

-- Auto-update updated_at trigger (reuses function from 001)
CREATE TRIGGER calls_updated_at
    BEFORE UPDATE ON public.calls
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
