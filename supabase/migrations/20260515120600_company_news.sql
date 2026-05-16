-- 0023_company_news.sql (mirror)
-- F3 — company news catalog. Nightly RSS cron writes; signed-in users read.
--
-- Write path: the cron (`news/google_news_rss.py`) connects via the
-- direct `SUPABASE_DB_URL` (postgres role, bypasses RLS) — no INSERT
-- policy is defined, so the only writer is that privileged connection.
-- Read path: every authenticated user reads the whole catalog; the
-- news-feed edge function scopes results to the caller's companies.
--
-- Dedupe: `title_hash` is sha256 of the lowercased, whitespace-stripped
-- headline. `UNIQUE (company_name, title_hash)` collapses the same story
-- re-syndicated under different URLs for the same company. `url` is also
-- globally unique as a cheap second guard.

BEGIN;

CREATE TABLE IF NOT EXISTS company_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  headline text NOT NULL,
  title_hash text NOT NULL,
  url text UNIQUE NOT NULL,
  summary text,
  source text,
  published_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (company_name, title_hash)
);

-- Feed query: latest non-archived headlines for a set of companies.
CREATE INDEX IF NOT EXISTS company_news_company_published
  ON company_news (company_name, published_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE company_news ENABLE ROW LEVEL SECURITY;

-- Public catalog: any authenticated user may read every row.
DROP POLICY IF EXISTS company_news_authenticated_read ON company_news;
CREATE POLICY company_news_authenticated_read ON company_news
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- No INSERT / UPDATE / DELETE policy: the nightly cron writes via the
-- privileged postgres connection only.

COMMIT;
