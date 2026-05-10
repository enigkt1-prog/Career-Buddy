-- 0015_rls_policies.sql
-- RLS enable + own-only policies on every user-scoped table, plus
-- BEFORE-INSERT triggers that force user_id = auth.uid()
-- (defense-in-depth in case RLS policies are accidentally dropped).
--
-- Idempotent: every CREATE is preceded by DROP IF EXISTS so a
-- partially-failed run can be safely re-applied.
--
-- Apply ONLY after 0014 has succeeded (depends on user_id NOT
-- NULL + FK + composite unique indexes). The migrate CLI picks
-- this up automatically since it takes no psql variable.
--
-- Plan-of-record: docs/MULTI_USER_RLS_PLAN.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- Idempotency guards: drop any prior policies / triggers first.
-- Postgres < 17 doesn't support IF NOT EXISTS on CREATE POLICY,
-- so the DROP-then-CREATE shape is the only safe path.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

ALTER TABLE user_profile         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tracks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_email_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_context_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_dismissals       ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Own-only policies — 4 verbs per user-scoped table
-- ---------------------------------------------------------------------------

-- user_profile
CREATE POLICY user_profile_select_own ON user_profile
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_profile_insert_own ON user_profile
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_profile_update_own ON user_profile
  FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_profile_delete_own ON user_profile
  FOR DELETE USING (auth.uid() = user_id);

-- user_tracks
CREATE POLICY user_tracks_select_own ON user_tracks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_tracks_insert_own ON user_tracks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_tracks_update_own ON user_tracks
  FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_tracks_delete_own ON user_tracks
  FOR DELETE USING (auth.uid() = user_id);

-- user_email_accounts
CREATE POLICY user_email_accounts_select_own ON user_email_accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_email_accounts_insert_own ON user_email_accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_email_accounts_update_own ON user_email_accounts
  FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_email_accounts_delete_own ON user_email_accounts
  FOR DELETE USING (auth.uid() = user_id);

-- user_context_notes
CREATE POLICY user_context_notes_select_own ON user_context_notes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_context_notes_insert_own ON user_context_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_context_notes_update_own ON user_context_notes
  FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_context_notes_delete_own ON user_context_notes
  FOR DELETE USING (auth.uid() = user_id);

-- applications
CREATE POLICY applications_select_own ON applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY applications_insert_own ON applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY applications_update_own ON applications
  FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY applications_delete_own ON applications
  FOR DELETE USING (auth.uid() = user_id);

-- events: scoped via application_id JOIN. Append-only by design
-- (events are immutable audit trail). UPDATE + DELETE are NOT
-- policy'd → effectively forbidden once RLS is on; the only way
-- to "delete" an event is to delete the parent application, which
-- cascades.
CREATE POLICY events_select_via_application ON events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = events.application_id
        AND a.user_id = auth.uid()
    )
  );
CREATE POLICY events_insert_via_application ON events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = events.application_id
        AND a.user_id = auth.uid()
    )
  );

-- job_dismissals own-only policies (no UPDATE — dismissals are
-- toggle: insert to dismiss, delete to un-dismiss).
CREATE POLICY job_dismissals_select_own ON job_dismissals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY job_dismissals_insert_own ON job_dismissals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY job_dismissals_delete_own ON job_dismissals
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Defense-in-depth: BEFORE INSERT triggers that overwrite any
-- client-supplied user_id with auth.uid(). The WITH CHECK RLS
-- policy ALREADY blocks INSERTs where the client-supplied user_id
-- ≠ auth.uid(), but a trigger is cheap insurance against
-- accidentally-dropped policies.
-- ---------------------------------------------------------------------------

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

COMMIT;
