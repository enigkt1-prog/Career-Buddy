-- 0022_user_target_companies.sql
-- F3 — companies a user explicitly wants news about.
--
-- Managed from the /news page (TargetCompaniesInput). Distinct from
-- `applications.company` (companies the user has applied to) — both
-- feed the company-news source list, but a target is a forward-looking
-- watch, not a tracked application.

BEGIN;

CREATE TABLE IF NOT EXISTS user_target_companies (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_name)
);

ALTER TABLE user_target_companies ENABLE ROW LEVEL SECURITY;

-- Self-only: a user reads and writes only their own watch-list rows.
DROP POLICY IF EXISTS user_target_companies_self ON user_target_companies;
CREATE POLICY user_target_companies_self ON user_target_companies
  FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

COMMIT;
