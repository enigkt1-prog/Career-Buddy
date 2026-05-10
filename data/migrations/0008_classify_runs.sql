-- 0008_classify_runs.sql
-- Tracks classify-CLI runs for cross-invocation quota accounting.
-- One row per run; jobs_written incremented per batch in same txn as job
-- updates so a crash mid-run leaves correct daily counts.
--
-- Used by:
--   - cli.classify (Tier-1 + Tier-1.5)
--   - cli.classify_tier2_claude (Claude-CLI batch)
--
-- Daily quota query:
--   SELECT COALESCE(SUM(jobs_written), 0)
--     FROM classify_runs
--    WHERE classifier = $1
--      AND started_at >= now() - interval '1 day';

CREATE TABLE IF NOT EXISTS classify_runs (
    run_id           uuid         PRIMARY KEY,
    classifier       text         NOT NULL,
    started_at       timestamptz  NOT NULL DEFAULT now(),
    last_updated_at  timestamptz  NOT NULL DEFAULT now(),
    jobs_written     int          NOT NULL DEFAULT 0,
    finished         bool         NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS classify_runs_classifier_started_idx
    ON classify_runs (classifier, started_at);
