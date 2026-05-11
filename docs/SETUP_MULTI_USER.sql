-- Career-Buddy multi-user bootstrap.
-- Run in Supabase SQL Editor as one shot.
--
-- Macht in einer transaction:
--   1. Dev user (enigkt1@gmail.com) in auth.users anlegen + UUID capture
--   2. 0014 — backfill aller user_id NULL rows, NOT NULL + FK auf
--      auth.users, COALESCE-indexes → real per-user indexes,
--      applications.client_id auf (user_id, client_id) repointen,
--      job_dismissals user_id + composite PK, public.users drop
--   3. 0015 — RLS enable + own-only policies (27 policies) +
--      BEFORE-INSERT triggers (6 trigger) auf alle user-scoped tables
--   4. 0016 — pgcrypto extension + encrypt/decrypt OAuth-token helpers
--   5. _migrations table entries marken
--
-- Was NICHT drin:
--   - Auth-Provider enable (Dashboard → Authentication → Providers)
--   - Master key set (siehe ALTER DATABASE statement am ENDE des
--     scripts — eine zeile, mit `openssl rand -hex 32` output ersetzen)
--   - OAuth-app credentials (Google Cloud + Azure AD Console)
--   - Edge function env vars (Dashboard → Edge Functions → Secrets)
--
-- Wenn was fehlschlägt → ROLLBACK automatisch. Sicher mehrfach
-- laufbar (IF EXISTS / ON CONFLICT überall).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Dev user in auth.users
-- ---------------------------------------------------------------------------
-- Direct insert into auth.users ist supported. Email-confirmed-at
-- auf now() = auto-confirm, kein magic-link nötig zum ersten Login.
-- Password ist NULL → user kann nur via magic-link / Google OAuth
-- rein (sicherer).

-- auth.users only has a PARTIAL unique index on email
-- (WHERE is_sso_user = false), so ON CONFLICT (email) can't target
-- it. Use WHERE NOT EXISTS instead — same idempotency guarantee.
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  is_super_admin, is_anonymous
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'enigkt1@gmail.com',
  NULL,
  now(),
  '{"provider":"email","providers":["email","google"]}'::jsonb,
  '{}'::jsonb,
  now(), now(),
  false, false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'enigkt1@gmail.com'
);

-- Capture UUID in a temp table so subsequent statements reference it.
CREATE TEMP TABLE _bootstrap AS
SELECT id AS user_id FROM auth.users WHERE email = 'enigkt1@gmail.com' LIMIT 1;

DO $$
DECLARE uid uuid;
BEGIN
  SELECT user_id INTO uid FROM _bootstrap;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'bootstrap user lookup failed — check auth.users';
  END IF;
  RAISE NOTICE 'bootstrap user_id = %', uid;
END $$;

-- ---------------------------------------------------------------------------
-- 2. 0014 — backfill + NOT NULL + FK + indexes
-- ---------------------------------------------------------------------------

-- 2.1 backfill aller NULL-rows
UPDATE user_email_accounts
   SET user_id = (SELECT user_id FROM _bootstrap)
 WHERE user_id IS NULL;
UPDATE user_tracks
   SET user_id = (SELECT user_id FROM _bootstrap)
 WHERE user_id IS NULL;
UPDATE user_profile
   SET user_id = (SELECT user_id FROM _bootstrap)
 WHERE user_id IS NULL;
UPDATE user_context_notes
   SET user_id = (SELECT user_id FROM _bootstrap)
 WHERE user_id IS NULL;

-- Sanity-check backfill
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM user_email_accounts WHERE user_id IS NULL
    UNION ALL SELECT 1 FROM user_tracks WHERE user_id IS NULL
    UNION ALL SELECT 1 FROM user_profile WHERE user_id IS NULL
    UNION ALL SELECT 1 FROM user_context_notes WHERE user_id IS NULL
  ) q;
  IF n > 0 THEN
    RAISE EXCEPTION '% NULL user_id rows remain after backfill', n;
  END IF;
END $$;

-- 2.2 drop COALESCE indexes
DROP INDEX IF EXISTS user_profile_user_id_idx;
DROP INDEX IF EXISTS user_tracks_user_id_idx;
DROP INDEX IF EXISTS user_email_accounts_user_email_idx;
DROP INDEX IF EXISTS user_email_accounts_one_primary_per_user_idx;

-- 2.3 NOT NULL + FK auf auth.users
ALTER TABLE user_profile
  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_profile
  DROP CONSTRAINT IF EXISTS user_profile_user_id_fkey,
  ADD CONSTRAINT user_profile_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE user_tracks
  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_tracks
  DROP CONSTRAINT IF EXISTS user_tracks_user_id_fkey,
  ADD CONSTRAINT user_tracks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE user_email_accounts
  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_email_accounts
  DROP CONSTRAINT IF EXISTS user_email_accounts_user_id_fkey,
  ADD CONSTRAINT user_email_accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE user_context_notes
  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_context_notes
  DROP CONSTRAINT IF EXISTS user_context_notes_user_id_fkey,
  ADD CONSTRAINT user_context_notes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- applications: drop legacy FK, blanket-rewrite zu bootstrap, re-FK auf auth.users
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_user_id_fkey;
UPDATE applications SET user_id = (SELECT user_id FROM _bootstrap);
ALTER TABLE applications
  ALTER COLUMN user_id SET NOT NULL,
  ADD CONSTRAINT applications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop legacy public.users (4-class dependency guard, RESTRICT)
DO $$
DECLARE
  bad_fk     int;
  bad_view   int;
  bad_fn     int;
  bad_trig   int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'users'
      AND relnamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE 'public.users does not exist — skip';
    RETURN;
  END IF;
  SELECT count(*) INTO bad_fk
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.confrelid
    WHERE t.relname = 'users' AND t.relnamespace = 'public'::regnamespace
      AND c.conrelid <> 'public.users'::regclass;
  SELECT count(*) INTO bad_view
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE t.relname = 'users' AND t.relnamespace = 'public'::regnamespace
      AND d.refobjsubid > 0;
  SELECT count(*) INTO bad_fn
    FROM pg_proc p
    WHERE p.prosrc LIKE '%public.users%' OR p.prosrc LIKE '%"public"."users"%';
  SELECT count(*) INTO bad_trig
    FROM pg_trigger tg
    JOIN pg_class t ON t.oid = tg.tgrelid
    WHERE t.relname = 'users' AND t.relnamespace = 'public'::regnamespace;
  IF (bad_fk + bad_view + bad_fn + bad_trig) > 0 THEN
    RAISE EXCEPTION
      'public.users has dependents: % FKs, % views, % functions, % triggers',
      bad_fk, bad_view, bad_fn, bad_trig;
  END IF;
END $$;
DROP TABLE IF EXISTS public.users RESTRICT;

-- 2.4 real per-user unique indexes
DROP INDEX IF EXISTS user_profile_one_per_user;
CREATE UNIQUE INDEX user_profile_one_per_user ON user_profile (user_id);
DROP INDEX IF EXISTS user_tracks_one_per_user;
CREATE UNIQUE INDEX user_tracks_one_per_user ON user_tracks (user_id);
DROP INDEX IF EXISTS user_email_accounts_user_email;
CREATE UNIQUE INDEX user_email_accounts_user_email
  ON user_email_accounts (user_id, email);
DROP INDEX IF EXISTS user_email_accounts_one_primary_per_user;
CREATE UNIQUE INDEX user_email_accounts_one_primary_per_user
  ON user_email_accounts (user_id) WHERE is_primary = true;

-- 2.5 applications.client_id zu FULL composite unique
UPDATE applications
   SET client_id = 'legacy_' || id::text
 WHERE client_id IS NULL;
ALTER TABLE applications ALTER COLUMN client_id SET NOT NULL;
DROP INDEX IF EXISTS ux_applications_client_id;
DROP INDEX IF EXISTS ux_applications_user_client_id;
CREATE UNIQUE INDEX ux_applications_user_client_id
  ON applications (user_id, client_id);

-- 2.6 job_dismissals: user_id + composite PK
ALTER TABLE job_dismissals
  ADD COLUMN IF NOT EXISTS user_id uuid;
UPDATE job_dismissals
   SET user_id = (SELECT user_id FROM _bootstrap)
 WHERE user_id IS NULL;
ALTER TABLE job_dismissals
  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE job_dismissals
  DROP CONSTRAINT IF EXISTS job_dismissals_user_id_fkey,
  ADD CONSTRAINT job_dismissals_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE job_dismissals DROP CONSTRAINT IF EXISTS job_dismissals_pkey;
ALTER TABLE job_dismissals
  ADD CONSTRAINT job_dismissals_pkey PRIMARY KEY (user_id, url);

-- 2.7 composite index für events RLS hot path
CREATE INDEX IF NOT EXISTS applications_id_user_id_idx
  ON applications (id, user_id);

-- ---------------------------------------------------------------------------
-- 3. 0015 — RLS policies + triggers
-- ---------------------------------------------------------------------------

-- 3.1 idempotency guards
DROP POLICY IF EXISTS user_profile_select_own ON user_profile;
DROP POLICY IF EXISTS user_profile_insert_own ON user_profile;
DROP POLICY IF EXISTS user_profile_update_own ON user_profile;
DROP POLICY IF EXISTS user_profile_delete_own ON user_profile;
DROP POLICY IF EXISTS user_tracks_select_own ON user_tracks;
DROP POLICY IF EXISTS user_tracks_insert_own ON user_tracks;
DROP POLICY IF EXISTS user_tracks_update_own ON user_tracks;
DROP POLICY IF EXISTS user_tracks_delete_own ON user_tracks;
DROP POLICY IF EXISTS user_email_accounts_select_own ON user_email_accounts;
DROP POLICY IF EXISTS user_email_accounts_insert_own ON user_email_accounts;
DROP POLICY IF EXISTS user_email_accounts_update_own ON user_email_accounts;
DROP POLICY IF EXISTS user_email_accounts_delete_own ON user_email_accounts;
DROP POLICY IF EXISTS user_context_notes_select_own ON user_context_notes;
DROP POLICY IF EXISTS user_context_notes_insert_own ON user_context_notes;
DROP POLICY IF EXISTS user_context_notes_update_own ON user_context_notes;
DROP POLICY IF EXISTS user_context_notes_delete_own ON user_context_notes;
DROP POLICY IF EXISTS applications_select_own ON applications;
DROP POLICY IF EXISTS applications_insert_own ON applications;
DROP POLICY IF EXISTS applications_update_own ON applications;
DROP POLICY IF EXISTS applications_delete_own ON applications;
DROP POLICY IF EXISTS events_select_via_application ON events;
DROP POLICY IF EXISTS events_insert_via_application ON events;
DROP POLICY IF EXISTS job_dismissals_select_own ON job_dismissals;
DROP POLICY IF EXISTS job_dismissals_insert_own ON job_dismissals;
DROP POLICY IF EXISTS job_dismissals_delete_own ON job_dismissals;
DROP TRIGGER IF EXISTS user_profile_force_caller_uid       ON user_profile;
DROP TRIGGER IF EXISTS user_tracks_force_caller_uid        ON user_tracks;
DROP TRIGGER IF EXISTS user_email_accounts_force_caller_uid ON user_email_accounts;
DROP TRIGGER IF EXISTS user_context_notes_force_caller_uid ON user_context_notes;
DROP TRIGGER IF EXISTS applications_force_caller_uid       ON applications;
DROP TRIGGER IF EXISTS job_dismissals_force_caller_uid     ON job_dismissals;

-- 3.2 enable RLS
ALTER TABLE user_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tracks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_email_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_context_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_dismissals       ENABLE ROW LEVEL SECURITY;

-- 3.3 own-only policies — 4 verbs per user-scoped table
CREATE POLICY user_profile_select_own ON user_profile
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_profile_insert_own ON user_profile
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_profile_update_own ON user_profile
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_profile_delete_own ON user_profile
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY user_tracks_select_own ON user_tracks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_tracks_insert_own ON user_tracks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_tracks_update_own ON user_tracks
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_tracks_delete_own ON user_tracks
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY user_email_accounts_select_own ON user_email_accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_email_accounts_insert_own ON user_email_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_email_accounts_update_own ON user_email_accounts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_email_accounts_delete_own ON user_email_accounts
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY user_context_notes_select_own ON user_context_notes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_context_notes_insert_own ON user_context_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_context_notes_update_own ON user_context_notes
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_context_notes_delete_own ON user_context_notes
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY applications_select_own ON applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY applications_insert_own ON applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY applications_update_own ON applications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY applications_delete_own ON applications
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY events_select_via_application ON events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM applications a
            WHERE a.id = events.application_id AND a.user_id = auth.uid())
  );
CREATE POLICY events_insert_via_application ON events
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM applications a
            WHERE a.id = events.application_id AND a.user_id = auth.uid())
  );

CREATE POLICY job_dismissals_select_own ON job_dismissals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY job_dismissals_insert_own ON job_dismissals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY job_dismissals_delete_own ON job_dismissals
  FOR DELETE USING (auth.uid() = user_id);

-- 3.4 BEFORE INSERT triggers (defense-in-depth)
CREATE OR REPLACE FUNCTION enforce_user_id_is_caller()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.user_id := auth.uid();
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated user required to insert into %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_profile_force_caller_uid
  BEFORE INSERT ON user_profile
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();
CREATE TRIGGER user_tracks_force_caller_uid
  BEFORE INSERT ON user_tracks
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();
CREATE TRIGGER user_email_accounts_force_caller_uid
  BEFORE INSERT ON user_email_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();
CREATE TRIGGER user_context_notes_force_caller_uid
  BEFORE INSERT ON user_context_notes
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();
CREATE TRIGGER applications_force_caller_uid
  BEFORE INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();
CREATE TRIGGER job_dismissals_force_caller_uid
  BEFORE INSERT ON job_dismissals
  FOR EACH ROW EXECUTE FUNCTION enforce_user_id_is_caller();

-- ---------------------------------------------------------------------------
-- 4. 0016 — pgcrypto + OAuth token helpers
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION encrypt_oauth_token(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  master_key text;
BEGIN
  master_key := current_setting('app.oauth_master_key', true);
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'app.oauth_master_key not set or too short';
  END IF;
  IF plaintext IS NULL OR plaintext = '' THEN
    RAISE EXCEPTION 'encrypt_oauth_token called with empty plaintext';
  END IF;
  RETURN pgp_sym_encrypt(plaintext, master_key);
END $$;

CREATE OR REPLACE FUNCTION decrypt_oauth_token(ciphertext bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  master_key text;
  plaintext  text;
BEGIN
  master_key := current_setting('app.oauth_master_key', true);
  IF master_key IS NULL OR length(master_key) < 32 THEN
    RAISE EXCEPTION 'app.oauth_master_key not set or too short';
  END IF;
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  BEGIN
    plaintext := pgp_sym_decrypt(ciphertext, master_key);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  RETURN plaintext;
END $$;

REVOKE ALL ON FUNCTION encrypt_oauth_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrypt_oauth_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encrypt_oauth_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION decrypt_oauth_token(bytea) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. _migrations tracker entries
-- ---------------------------------------------------------------------------

INSERT INTO _migrations (filename) VALUES
  ('0014_auth_user_id_fk.sql'),
  ('0015_rls_policies.sql'),
  ('0016_oauth_token_crypto.sql')
ON CONFLICT (filename) DO NOTHING;

-- Final sanity: show bootstrap UUID so user can copy it for the
-- handoff doc.
SELECT 'bootstrap_user_id' AS label, user_id AS uuid FROM _bootstrap;

COMMIT;

-- ---------------------------------------------------------------------------
-- AFTER COMMIT: separate one-liner für den master-key.
-- Generate locally first:  openssl rand -hex 32
-- Dann diese line ausführen (in neuem SQL Editor tab, NICHT in
-- der transaction oben — ALTER DATABASE läuft outside-transaction):
--
--   ALTER DATABASE postgres SET app.oauth_master_key TO 'PASTE-32-BYTE-HEX-HERE';
--
-- Nach dem ALTER musst du die Edge-Function einmal redeployen
-- damit sie die GUC liest (oder warten ~1 min auf den nächsten
-- connection-reset).
-- ---------------------------------------------------------------------------
