#!/usr/bin/env bash
# Morning smoke-test: runs after the Gemini Free Tier daily quota resets.
# Verifies all 3 edge functions return JSON (not 429), then triggers
# Tier-2 reclassification on the unclassified subset of jobs.
#
# Usage:
#   bash scripts/morning_check.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ ! -f .env ]]; then
  echo "✗ .env missing; run from repo root"
  exit 1
fi

ANON=$(grep "^SUPABASE_ANON_KEY=" .env | cut -d= -f2-)
SUPA="https://gxnpfbzfqgbhnyqunuwf.supabase.co"

echo "→ analyze-cv"
ac_status=$(curl -s -o /tmp/cb_ac.json -w "%{http_code}" \
  -X POST "$SUPA/functions/v1/analyze-cv" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{"cvText":"Sample Candidate. Strategy graduate, 1y B2B sales at Acme Corp, German native, English C1.","targetProfile":"Founders Associate, Berlin"}')
echo "  HTTP $ac_status   $(head -c 200 /tmp/cb_ac.json)"

echo "→ match-job"
mj_status=$(curl -s -o /tmp/cb_mj.json -w "%{http_code}" \
  -X POST "$SUPA/functions/v1/match-job" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{
    "profile":{"name":"Sample Candidate","headline":"Strategy graduate, B2B sales","target_role":"Founders Associate","target_geo":"Berlin","strengths":["B2B sales","German native"],"work_history":[{"company":"Acme","role":"BDR","start_date":"2024-09","end_date":"2025-08","bullets":["Closed 14 deals worth €450k"]}]},
    "job":{"company":"Stripe","role":"Strategy Associate","location":"Berlin","description":"Strategy Associate at Stripe...","requirements":"2-4 years strategy/operating role; SQL; English fluent."}
  }')
echo "  HTTP $mj_status   $(head -c 200 /tmp/cb_mj.json)"

echo "→ draft-message (cover_letter)"
dm_status=$(curl -s -o /tmp/cb_dm.json -w "%{http_code}" \
  -X POST "$SUPA/functions/v1/draft-message" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d '{
    "kind":"cover_letter",
    "profile":{"name":"Sample Candidate","headline":"Strategy graduate, B2B sales","target_role":"Founders Associate","target_geo":"Berlin","strengths":["B2B sales"],"work_history":[{"company":"Acme","role":"BDR","start_date":"2024-09","end_date":"2025-08","bullets":["Closed 14 deals worth €450k"]}]},
    "job":{"company":"Stripe","role":"Strategy Associate","location":"Berlin","description":"Stripe seeks a Strategy Associate.","requirements":"2-4 years experience; SQL; English."}
  }')
echo "  HTTP $dm_status   $(head -c 200 /tmp/cb_dm.json)"

echo
if [[ "$ac_status" == "200" && "$mj_status" == "200" && "$dm_status" == "200" ]]; then
  echo "✓ All edge functions healthy."
else
  echo "⚠ One or more edge functions did not return 200. Inspect /tmp/cb_*.json."
fi

echo
echo "→ Tier-2 reclassify (best-effort, stops at quota)"
cd backend
# Quota exhaustion (Gemini 429) is expected on Free Tier — classify_tier2
# returns 1 cleanly with a red log when that happens. Anything else
# (parse error, DB connection, code crash) is unexpected — bubble up.
set +e
uv run python -m career_buddy_scraper.cli.classify_tier2
rc=$?
set -e
if [[ "$rc" -ne 0 && "$rc" -ne 1 ]]; then
  echo "✗ Tier-2 classifier exited unexpectedly with code $rc"
  exit "$rc"
fi

echo
echo "→ Counts"
uv run python - <<'PY'
import os, psycopg
from career_buddy_scraper.db import load_env
load_env()
with psycopg.connect(os.environ['SUPABASE_DB_URL']) as conn, conn.cursor() as cur:
    cur.execute("select count(*), count(*) filter (where role_category is not null and role_category!='other') from jobs where is_active=true")
    total, classified = cur.fetchone()
    print(f"jobs.is_active = {total}, role_category specific = {classified} ({100*classified//total}%)")
PY

echo "Done."
