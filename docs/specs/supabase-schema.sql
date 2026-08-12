-- ============================================================
-- ContractIQ — Supabase Schema
-- Paste this entire file into the Supabase SQL Editor and run.
-- Requires a fresh project (or will safely skip existing objects).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ────────────────────────────────────────────────────────────
-- TABLES (in dependency order)
-- ────────────────────────────────────────────────────────────

-- 1. contracts
--    One row per uploaded PDF. The extracted text is stored here
--    so the AI pipeline never re-downloads the file from Storage.
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
  last_accessed_at  timestamptz   NOT NULL DEFAULT now()
);

-- 2. key_terms
--    One row per extracted term (standard or custom) per contract.
CREATE TABLE IF NOT EXISTS key_terms (
  id               uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id      uuid          NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id          uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_name        text          NOT NULL,
  value            text          NOT NULL,
  page_number      integer,                        -- 1-indexed; NULL if model could not attribute
  confidence_score numeric(5,4)  NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  source_sentence  text          NOT NULL,
  is_edited        boolean       NOT NULL DEFAULT false,
  original_value   text,                           -- Set on first user edit; never overwritten again
  is_manual        boolean       NOT NULL DEFAULT false,  -- true for custom (user-defined) terms
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- 3. custom_key_terms
--    User-defined term names added before processing.
--    Read at extraction time to append to the prompt.
CREATE TABLE IF NOT EXISTS custom_key_terms (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_name    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4. chat_sessions
--    One session per contract per user. Groups all chat messages.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, user_id)   -- one session per contract per user
);

-- 5. chat_messages
--    Persistent chat history. Ordered by created_at ASC = conversation order.
CREATE TABLE IF NOT EXISTS chat_messages (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 6. user_feedback
--    Thumbs-up / thumbs-down per contract review. One row per user per contract.
CREATE TABLE IF NOT EXISTS user_feedback (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating       text        NOT NULL CHECK (rating IN ('up', 'down')),
  comment      text,                              -- Optional; max 1,000 chars enforced at API layer
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, user_id)                  -- UPSERT target; one feedback per user per contract
);

-- 7. term_corrections
--    Audit log of every user edit to a key term.
--    Feeds the prompt-improvement loop (correction rate metric).
CREATE TABLE IF NOT EXISTS term_corrections (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_term_id      uuid        NOT NULL REFERENCES key_terms(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_value   text        NOT NULL,
  corrected_value  text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────

-- contracts
CREATE INDEX IF NOT EXISTS idx_contracts_user_id
  ON contracts (user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_created
  ON contracts (user_id, created_at DESC);

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

-- chat_messages — ASC order is the hot path for fetching history
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at ASC);

-- term_corrections
CREATE INDEX IF NOT EXISTS idx_term_corrections_key_term_id
  ON term_corrections (key_term_id);
CREATE INDEX IF NOT EXISTS idx_term_corrections_user_id
  ON term_corrections (user_id);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE contracts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_terms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_key_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback   ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_corrections ENABLE ROW LEVEL SECURITY;

-- contracts policies
CREATE POLICY "contracts: users select own"
  ON contracts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contracts: users insert own"
  ON contracts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contracts: users update own"
  ON contracts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "contracts: users delete own"
  ON contracts FOR DELETE USING (auth.uid() = user_id);

-- key_terms policies
CREATE POLICY "key_terms: users select own"
  ON key_terms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "key_terms: users insert own"
  ON key_terms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "key_terms: users update own"
  ON key_terms FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "key_terms: users delete own"
  ON key_terms FOR DELETE USING (auth.uid() = user_id);

-- custom_key_terms policies
CREATE POLICY "custom_key_terms: users select own"
  ON custom_key_terms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "custom_key_terms: users insert own"
  ON custom_key_terms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "custom_key_terms: users delete own"
  ON custom_key_terms FOR DELETE USING (auth.uid() = user_id);

-- chat_sessions policies
CREATE POLICY "chat_sessions: users select own"
  ON chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_sessions: users insert own"
  ON chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- chat_messages policies
CREATE POLICY "chat_messages: users select own"
  ON chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_messages: users insert own"
  ON chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- user_feedback policies
CREATE POLICY "user_feedback: users select own"
  ON user_feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_feedback: users insert own"
  ON user_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_feedback: users update own"
  ON user_feedback FOR UPDATE USING (auth.uid() = user_id);

-- term_corrections policies
CREATE POLICY "term_corrections: users select own"
  ON term_corrections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "term_corrections: users insert own"
  ON term_corrections FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- STORAGE BUCKET + POLICIES
-- ────────────────────────────────────────────────────────────

-- Create the private bucket for PDF uploads.
-- File path pattern: contracts/{user_id}/{contract_id}/{filename}.pdf
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  false,                        -- private bucket
  10485760,                     -- 10 MB limit enforced at bucket level
  ARRAY['application/pdf']      -- only PDFs accepted
)
ON CONFLICT (id) DO NOTHING;

-- Storage INSERT: users can upload only into their own folder
CREATE POLICY "storage: users upload own contracts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage SELECT: users can read only their own files
CREATE POLICY "storage: users read own contracts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage DELETE: users can delete only their own files
CREATE POLICY "storage: users delete own contracts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
