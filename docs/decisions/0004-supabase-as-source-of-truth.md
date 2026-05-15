# 0004 — Supabase as source-of-truth (vcs + jobs), JSON only as cache

- **Status:** Accepted
- **Date:** 2026-05-08
- **Deciders:** Project lead

## Context

`docs/scraper-plan.md` originally specified writing the VC master list and the scraped job rows to flat JSON files (`data/vc_master_list.json`, `data/jobs.json`) under the rationale that JSON is reproducible and grep-able. The Layer-0 hackathon also pre-existed a Supabase project (`gxnpfbzfqgbhnyqunuwf.supabase.co`) with `users`, `applications`, `events`, `vc_jobs` tables already created and the credentials wired in `.env`.

Two real problems with the JSON-only approach:

1. **Reads.** A growing master list (1,500+ VCs) and jobs table (5k+ active rows) cannot be queried from the frontend or from the Layer-2 fit-scorer without re-parsing the whole file every time. The Layer-0 frontend already knows how to read Supabase; using JSON would force a parallel reader.
2. **Writes.** The daily refresh has to do upserts with merge logic (sector_tag union, source-array union, last_seen_at update). Doing this in Python against JSON requires a load → mutate → write loop with file locks. Postgres does it in a single `INSERT … ON CONFLICT … DO UPDATE` with array union expressions.

## Decision

Supabase Postgres is the source-of-truth for Layer-1 scraper output:

- Two new tables (`vcs`, `jobs`) added via migration `data/migrations/0002_layer1_scraper.sql`. Schema mirrors the Pydantic models in `backend/career_buddy_scraper/models.py`.
- A migration runner (`career_buddy_scraper.cli.migrate`) tracks applied filenames in a `_migrations` table so re-runs are idempotent.
- `master_list.upsert_into_supabase()` writes `VcRecord`s directly. A defensive `merge()` runs before each upsert so callers can pass raw scraper output. Sector-tag and source-array merges happen server-side via `array(select distinct unnest(... || ...))`.
- `master_list.write_json()` remains as an optional cache / debug aid. Same for any future `jobs_export.py`.
- The Layer-0 `vc_jobs` table stays untouched so the Lovable frontend keeps working. Layer-1 writes to `jobs`, not `vc_jobs`. A future migration may collapse the two; not now.

## Consequences

**Positive:**
- Frontend (Lovable, Layer-0 today, full app later) can issue fit-score and filter queries directly against `jobs` without re-parsing JSON.
- Daily refresh upserts get array-union semantics for free via SQL.
- `_migrations` table makes the schema-version-on-Supabase observable. We can diff `data/migrations/*.sql` against `select filename from _migrations` to detect drift.
- `psycopg[binary]` is the only new runtime dependency; `supabase-py` is not pulled in (we don't need its auth helpers in a backend cron).

**Negative:**
- Tests that exercise the upsert path require a live DB connection. Mitigation: unit tests cover `merge()` and `normalize_domain()` in isolation; the upsert path is exercised manually in a smoke-test today, and as a separate `pytest.mark.integration` suite later (skipped in CI without `SUPABASE_DB_URL`).
- Local development without internet cannot exercise the full path. Mitigation: `write_json()` still works for offline iteration on `merge()` semantics.
- Schema changes require a migration file, not a code-side change. Acceptable: this is the whole point of versioned migrations.

**Neutral:**
- We commit the Layer-0 baseline (`0001_layer0_baseline.sql`) as a historical record even though it is already applied to the live project. Future contributors restoring from a clean DB run `migrate --all` and get back to current state.

## Alternatives considered

- **JSON-only (the original plan).** Rejected per Context above: reads scale poorly, upsert semantics get reinvented in Python.
- **Supabase via the JS SDK from the scraper.** Rejected: pulling Node into a Python project for one client doubles the toolchain.
- **`supabase-py` instead of `psycopg`.** Rejected for v0.1: `supabase-py` wraps PostgREST, which does not run DDL (migrations would still need raw Postgres). Using `psycopg` for both DDL and upserts keeps one client. We can add `supabase-py` later if we need its real-time / storage / auth features.
- **Separate analytics warehouse (DuckDB, Parquet on S3).** Premature. Postgres handles 100k rows trivially. Revisit if cross-investor analytics become a separate workload.
