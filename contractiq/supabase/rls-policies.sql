-- ============================================================
-- ContractIQ — RLS Policies & Rate Limit Table
-- Run this in the Supabase SQL Editor after database.sql
-- ============================================================

-- ── Rate limit events table (service-role only) ──────────────────────────────
-- No user-facing RLS — accessed exclusively via service role key in rateLimiter.ts

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text        NOT NULL,
  action     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user_action_time
  ON rate_limit_events (user_id, action, created_at DESC);

-- No RLS on this table — it is accessed only via the service role key.
-- The service role bypasses RLS entirely, so no policies are needed.

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Deny all access for authenticated/anon roles (service role bypasses this)
CREATE POLICY "rate_limit_events_deny_all"
  ON rate_limit_events
  FOR ALL
  TO authenticated, anon
  USING (false);


-- ── context_type column migration ────────────────────────────────────────────
-- Run this if you haven't already (safe to re-run — uses IF NOT EXISTS)

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS context_type text
  CHECK (context_type IN ('contract', 'history', 'both'));


-- ── Verify all tables have RLS enabled ───────────────────────────────────────
-- (These are set in database.sql; duplicated here as a safety check)

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_terms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_key_terms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback     ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_corrections  ENABLE ROW LEVEL SECURITY;


-- ── Storage bucket policy ─────────────────────────────────────────────────────
-- Enforces {user_id}/{contract_id}/{filename}.pdf path convention.
-- Users can only read/write their own folder.

-- Allow authenticated users to upload to their own folder
CREATE POLICY "contracts_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to read their own files
CREATE POLICY "contracts_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow authenticated users to delete their own files
CREATE POLICY "contracts_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'contracts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
