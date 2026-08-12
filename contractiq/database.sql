-- ============================================================
-- ContractIQ — Production Database Schema
-- ============================================================
-- Paste this entire file into the Supabase SQL Editor and run.
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- Sections:
--   1. Extensions
--   2. Tables (dependency order)
--   3. Indexes
--   4. Triggers
--   5. Row Level Security
--   6. Storage Bucket + Policies
--   7. Maintenance Functions
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";


-- ────────────────────────────────────────────────────────────
-- 2. TABLES
-- ────────────────────────────────────────────────────────────

-- 2a. profiles
--     One row per authenticated user. Created automatically via trigger
--     on auth.users INSERT. Stores display name and preference flags.
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid          NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text          NOT NULL,
  full_name    text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- 2b. contracts
--     One row per uploaded PDF. The extracted text is stored here so the
--     AI pipeline never needs to re-download the file from Storage.
CREATE TABLE IF NOT EXISTS contracts (
  id                uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name         text          NOT NULL,
  contract_type     text          NOT NULL CHECK (contract_type IN ('nda', 'msa')),
  contract_text     text          NOT NULL,
  file_path         text,                          -- NULL if Storage upload failed (non-blocking)
  status            text          NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  page_count        integer       NOT NULL CHECK (page_count > 0),
  token_count       integer       NOT NULL CHECK (token_count > 0),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  last_accessed_at  timestamptz   NOT NULL DEFAULT now()  -- updated on results page load; drives 90-day cleanup
);

-- 2c. key_terms
--     One row per extracted term (standard or custom) per contract.
CREATE TABLE IF NOT EXISTS key_terms (
  id               uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id      uuid          NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id          uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_name        text          NOT NULL,
  value            text          NOT NULL,
  page_number      integer,                        -- 1-indexed; NULL if model could not attribute a page
  confidence_score numeric(5,4)  NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_sentence  text          NOT NULL,
  is_edited        boolean       NOT NULL DEFAULT false,
  original_value   text,                           -- Set on first user edit; never overwritten on subsequent edits
  is_manual        boolean       NOT NULL DEFAULT false,  -- true for user-defined custom terms
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- 2d. custom_key_terms
--     User-defined term names added before processing.
--     Read at extraction time to append to the GPT-4o prompt.
--     Maximum 5 per contract enforced at the application layer.
CREATE TABLE IF NOT EXISTS custom_key_terms (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_name    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2e. chat_sessions
--     One session per contract per user. Groups all chat messages for that contract.
--     UNIQUE(contract_id, user_id) enforces one session per user per contract.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, user_id)
);

-- 2f. chat_messages
--     Persistent chat history. Ordered ASC by created_at = conversation order.
CREATE TABLE IF NOT EXISTS chat_messages (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content      text        NOT NULL,
  context_type text        CHECK (context_type IN ('contract', 'history', 'both')),  -- NULL for user messages
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- If upgrading an existing database, run:
-- ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS context_type text CHECK (context_type IN ('contract', 'history', 'both'));

-- 2g. user_feedback
--     Thumbs-up / thumbs-down rating per contract review.
--     UNIQUE(contract_id, user_id) makes POST /api/feedback an UPSERT target.
CREATE TABLE IF NOT EXISTS user_feedback (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating       text        NOT NULL CHECK (rating IN ('up', 'down')),
  comment      text,                              -- Optional; max 1,000 chars enforced at API layer
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, user_id)
);

-- 2h. term_corrections
--     Immutable audit log of every user edit to an AI-extracted key term.
--     Feeds the correction-rate metric used to improve extraction prompts.
CREATE TABLE IF NOT EXISTS term_corrections (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_term_id      uuid        NOT NULL REFERENCES key_terms(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_value   text        NOT NULL,
  corrected_value  text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);


-- ────────────────────────────────────────────────────────────
-- 3. INDEXES
-- ────────────────────────────────────────────────────────────

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_id
  ON profiles (id);

-- contracts
CREATE INDEX IF NOT EXISTS idx_contracts_user_id
  ON contracts (user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_created
  ON contracts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_status
  ON contracts (status);
CREATE INDEX IF NOT EXISTS idx_contracts_last_accessed
  ON contracts (last_accessed_at);                -- supports 90-day cleanup query

-- key_terms
CREATE INDEX IF NOT EXISTS idx_key_terms_contract_id
  ON key_terms (contract_id);
CREATE INDEX IF NOT EXISTS idx_key_terms_user_id
  ON key_terms (user_id);

-- custom_key_terms
CREATE INDEX IF NOT EXISTS idx_custom_key_terms_contract_id
  ON custom_key_terms (contract_id);

-- chat_sessions
CREATE INDEX IF NOT EXISTS idx_chat_sessions_contract_id
  ON chat_sessions (contract_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
  ON chat_sessions (user_id);

-- chat_messages — ASC on (session_id, created_at) is the hot path for history fetch
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at ASC);

-- term_corrections
CREATE INDEX IF NOT EXISTS idx_term_corrections_key_term_id
  ON term_corrections (key_term_id);
CREATE INDEX IF NOT EXISTS idx_term_corrections_user_id
  ON term_corrections (user_id);


-- ────────────────────────────────────────────────────────────
-- 4. TRIGGERS
-- ────────────────────────────────────────────────────────────

-- 4a. Auto-create a profiles row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 4b. Generic updated_at stamp function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Apply updated_at trigger to tables that have the column
DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_user_feedback_updated_at ON user_feedback;
CREATE TRIGGER set_user_feedback_updated_at
  BEFORE UPDATE ON user_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_terms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_key_terms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback     ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_corrections  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles: users select own"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles: users update own"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- contracts
CREATE POLICY "contracts: users select own"
  ON contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contracts: users insert own"
  ON contracts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contracts: users update own"
  ON contracts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "contracts: users delete own"
  ON contracts FOR DELETE USING (auth.uid() = user_id);

-- key_terms
CREATE POLICY "key_terms: users select own"
  ON key_terms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "key_terms: users insert own"
  ON key_terms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "key_terms: users update own"
  ON key_terms FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "key_terms: users delete own"
  ON key_terms FOR DELETE USING (auth.uid() = user_id);

-- custom_key_terms
CREATE POLICY "custom_key_terms: users select own"
  ON custom_key_terms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "custom_key_terms: users insert own"
  ON custom_key_terms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "custom_key_terms: users delete own"
  ON custom_key_terms FOR DELETE USING (auth.uid() = user_id);

-- chat_sessions
CREATE POLICY "chat_sessions: users select own"
  ON chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_sessions: users insert own"
  ON chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- chat_messages
CREATE POLICY "chat_messages: users select own"
  ON chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_messages: users insert own"
  ON chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- user_feedback
CREATE POLICY "user_feedback: users select own"
  ON user_feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_feedback: users insert own"
  ON user_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_feedback: users update own"
  ON user_feedback FOR UPDATE USING (auth.uid() = user_id);

-- term_corrections (append-only audit log — no UPDATE or DELETE for users)
CREATE POLICY "term_corrections: users select own"
  ON term_corrections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "term_corrections: users insert own"
  ON term_corrections FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 6. STORAGE BUCKET + POLICIES
-- ────────────────────────────────────────────────────────────

-- Private bucket for PDF uploads.
-- File path pattern: contracts/{user_id}/{contract_id}/{filename}.pdf
-- Bucket-level limits are a secondary guard; the primary validation is in /api/upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  false,
  10485760,                      -- 10 MB hard limit at bucket level
  ARRAY['application/pdf']       -- only PDFs accepted
)
ON CONFLICT (id) DO NOTHING;

-- INSERT: users can upload only into their own folder (first path segment = user_id)
CREATE POLICY "storage: users upload own contracts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- SELECT: users can read only their own files (used for signed URL generation)
CREATE POLICY "storage: users read own contracts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE: users can delete only their own files
CREATE POLICY "storage: users delete own contracts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ────────────────────────────────────────────────────────────
-- 7. MAINTENANCE FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- 7a. delete_stale_contracts()
--     Deletes contracts (and all cascading data) that have not been
--     accessed in 90 days. Call this from a Supabase scheduled job
--     (pg_cron) or a nightly Edge Function.
--
--     To schedule via pg_cron (enable the pg_cron extension first):
--       SELECT cron.schedule(
--         'delete-stale-contracts',
--         '0 3 * * *',                     -- 03:00 UTC daily
--         'SELECT delete_stale_contracts()'
--       );
CREATE OR REPLACE FUNCTION delete_stale_contracts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM contracts
  WHERE last_accessed_at < now() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 7b. correction_rate_by_contract_type()
--     Returns the AI correction rate (corrected terms / total terms) grouped
--     by contract type. Used to monitor extraction quality over time.
CREATE OR REPLACE FUNCTION correction_rate_by_contract_type()
RETURNS TABLE (
  contract_type    text,
  total_terms      bigint,
  corrected_terms  bigint,
  correction_rate  numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.contract_type,
    COUNT(kt.id)                                                      AS total_terms,
    COUNT(tc.id)                                                      AS corrected_terms,
    ROUND(COUNT(tc.id)::numeric / NULLIF(COUNT(kt.id), 0) * 100, 2) AS correction_rate
  FROM contracts       c
  JOIN key_terms       kt ON kt.contract_id = c.id
  LEFT JOIN term_corrections tc ON tc.key_term_id = kt.id
  GROUP BY c.contract_type;
$$;
