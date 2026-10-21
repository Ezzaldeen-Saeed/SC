-- ════════════════════════════════════════════════════════════════════════
--  Smart Call Monitor — Final schema (idempotent · safe to re-run)
--
--  ▶ Run this WHOLE file in Supabase → SQL Editor (works on a fresh project
--    AND on the existing DB), then RESTART the Node backend.
--  It creates every table, brings older DBs up to date (parent_id, last_login,
--  sentiment/summary, customer_satisfaction_score…), wires FKs/indexes, and
--  enables Supabase Realtime on the live tables.
-- ════════════════════════════════════════════════════════════════════════

-- ── (0) Extensions ────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── (1) Base tables (fresh installs) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers (
  customer_id  uuid NOT NULL DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  phone_number text NOT NULL UNIQUE,
  email        text,
  CONSTRAINT customers_pkey PRIMARY KEY (customer_id)
);

CREATE TABLE IF NOT EXISTS public.users (
  user_id       uuid NOT NULL DEFAULT uuid_generate_v4(),
  username      text NOT NULL UNIQUE,
  full_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('admin','manager','supervisor','agent')),
  phone         text,
  created_at    timestamptz DEFAULT now(),
  last_login    timestamptz,
  is_active     boolean DEFAULT true,
  password_hash text,
  parent_id     uuid,
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.calls (
  call_id         uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id         uuid,
  customer_id     uuid,
  call_start      timestamptz DEFAULT now(),
  call_end        timestamptz,
  duration        interval,
  call_type       text,
  issues_category text,
  recording_path  text,
  sentiment       text,
  summary         text,
  analysis        jsonb,
  CONSTRAINT calls_pkey PRIMARY KEY (call_id),
  CONSTRAINT calls_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL,
  CONSTRAINT calls_user_id_fkey     FOREIGN KEY (user_id)     REFERENCES public.users(user_id)         ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.transcripts (
  transcript_id uuid NOT NULL DEFAULT uuid_generate_v4(),
  call_id       uuid,
  speaker       text NOT NULL,
  text          text NOT NULL,
  timestamp     time without time zone NOT NULL,
  summary       text,
  CONSTRAINT transcripts_pkey PRIMARY KEY (transcript_id),
  CONSTRAINT transcripts_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.performance_scores (
  score_id                    uuid NOT NULL DEFAULT uuid_generate_v4(),
  call_id                     uuid,
  script_compliance           integer CHECK (script_compliance           >= 0 AND script_compliance           <= 100),
  empathy_score               integer CHECK (empathy_score               >= 0 AND empathy_score               <= 100),
  resolution_score            integer CHECK (resolution_score            >= 0 AND resolution_score            <= 100),
  total_score                 integer CHECK (total_score                 >= 0 AND total_score                 <= 100),
  customer_satisfaction_score integer CHECK (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 100),
  CONSTRAINT performance_scores_pkey PRIMARY KEY (score_id),
  CONSTRAINT performance_scores_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE
);

-- Live-coaching suggestions shown to the agent during the call (persisted with it).
CREATE TABLE IF NOT EXISTS public.suggestions (
  suggest_id   uuid NOT NULL DEFAULT uuid_generate_v4(),
  call_id      uuid,
  suggest_text text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  agent_action text,
  priority     text DEFAULT 'medium',
  CONSTRAINT suggestions_pkey PRIMARY KEY (suggest_id),
  CONSTRAINT suggestions_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid,
  action      varchar(50)  NOT NULL,
  resource    varchar(100) NOT NULL,
  resource_id varchar(255),
  details     jsonb DEFAULT '{}'::jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL
);

-- "نسيت كلمة المرور" — one row per OTP request. code_hash is a bcrypt hash: a DB
-- leak must not hand out working reset codes. A row is spent once consumed_at is
-- set, once expires_at passes, or once attempts hits OTP_MAX_ATTEMPTS.
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  otp_id      uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_otps_pkey PRIMARY KEY (otp_id),
  CONSTRAINT password_reset_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- ── (2) Upgrade older DBs: rename manager_id → parent_id (guarded) ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='users' AND column_name='manager_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='users' AND column_name='parent_id') THEN
    ALTER TABLE public.users RENAME COLUMN manager_id TO parent_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_fkey') THEN
    ALTER TABLE public.users RENAME CONSTRAINT users_manager_id_fkey TO users_parent_id_fkey;
  END IF;
END $$;
ALTER INDEX IF EXISTS idx_users_manager_id RENAME TO idx_users_parent_id;

-- ── (3) Columns added over time (no-ops if already present) ────────────────
ALTER TABLE public.users     ADD COLUMN IF NOT EXISTS last_login timestamptz;
ALTER TABLE public.users     ADD COLUMN IF NOT EXISTS parent_id  uuid;
ALTER TABLE public.calls     ADD COLUMN IF NOT EXISTS sentiment  text;
ALTER TABLE public.calls     ADD COLUMN IF NOT EXISTS summary    text;
ALTER TABLE public.calls     ADD COLUMN IF NOT EXISTS analysis   jsonb;
ALTER TABLE public.performance_scores
  ADD COLUMN IF NOT EXISTS customer_satisfaction_score integer
  CHECK (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 100);
-- Live-coaching categorisation: type of problem + type of suggestion, so saved
-- suggestions stay organised and filterable (matches the realtime analyser output).
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS problem_type    text;
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS suggestion_type text;

-- Supabase Auth lowercases its own copy of the address, but older rows here kept
-- whatever case the admin typed. "نسيت كلمة المرور" looks the account up by email,
-- so a mixed-case row would report a real user as unregistered. Normalise once.
UPDATE public.users SET email = lower(email) WHERE email <> lower(email);

-- ── (4) Constraints (role whitelist + ON DELETE behaviour) ────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD  CONSTRAINT users_role_check CHECK (role IN ('admin','manager','supervisor','agent'));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_parent_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_manager_id_fkey;
ALTER TABLE public.users ADD  CONSTRAINT users_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_user_id_fkey;
ALTER TABLE public.calls ADD  CONSTRAINT calls_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE public.performance_scores DROP CONSTRAINT IF EXISTS performance_scores_call_id_fkey;
ALTER TABLE public.performance_scores ADD  CONSTRAINT performance_scores_call_id_fkey
  FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE;

ALTER TABLE public.transcripts DROP CONSTRAINT IF EXISTS transcripts_call_id_fkey;
ALTER TABLE public.transcripts ADD  CONSTRAINT transcripts_call_id_fkey
  FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE;

ALTER TABLE public.suggestions DROP CONSTRAINT IF EXISTS suggestions_call_id_fkey;
ALTER TABLE public.suggestions ADD  CONSTRAINT suggestions_call_id_fkey
  FOREIGN KEY (call_id) REFERENCES public.calls(call_id) ON DELETE CASCADE;

-- ── (5) Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_parent_id     ON public.users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_role          ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_calls_user_id       ON public.calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_customer_id   ON public.calls(customer_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_start    ON public.calls(call_start DESC);
CREATE INDEX IF NOT EXISTS idx_perf_scores_call_id ON public.performance_scores(call_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON public.transcripts(call_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_call_id ON public.suggestions(call_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
-- Lookup path is always "newest live OTP for this user".
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_id ON public.password_reset_otps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires ON public.password_reset_otps(expires_at);

-- ── (6) audit_logs RLS (Node uses the service role, which bypasses RLS) ────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access" ON public.audit_logs;
CREATE POLICY "Service role has full access" ON public.audit_logs
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Admins can read audit logs" ON public.audit_logs;
CREATE POLICY "Admins can read audit logs" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE users.user_id = auth.uid() AND users.role = 'admin')
  );

-- password_reset_otps: service role ONLY. Deliberately no admin/self read policy —
-- with RLS on and no matching policy, every anon/authenticated request returns
-- nothing, so a stolen anon key can't enumerate live reset codes. Node reaches
-- this table exclusively through the service-role client.
ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access" ON public.password_reset_otps;
CREATE POLICY "Service role has full access" ON public.password_reset_otps
  FOR ALL USING (auth.role() = 'service_role');

-- ── (7) Supabase Realtime — stream inserts/updates on the live tables ──────
--    Lets clients subscribe to changes instead of polling. (The app also has a
--    scoped server-side SSE stream; this publication is ready if you later add
--    Supabase-Auth-based browser subscriptions.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calls','suggestions','performance_scores','transcripts','customers'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'supabase_realtime publication not found — skipping (not on Supabase?)';
END $$;
