-- 0017_analytics_events.sql (mirror)
-- F0 — generic, append-only event log for retention/funnel telemetry.
-- Canonical source: data/migrations/0017_analytics_events.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_user_created
  ON analytics_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analytics_events_name_created
  ON analytics_events (event_name, created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_events_self_read ON analytics_events;
CREATE POLICY analytics_events_self_read ON analytics_events
  FOR SELECT
  USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS analytics_events_insert ON analytics_events;
CREATE POLICY analytics_events_insert ON analytics_events
  FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

COMMIT;
