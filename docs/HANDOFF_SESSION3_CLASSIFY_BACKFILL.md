# HANDOFF — Career-Buddy SESSION 3 (classify + Layer-3 backfill)

> Fresh chat. Read this top-to-bottom before doing anything.
>
> Two existing sessions (**A** = UI, **B** = backend + tooling) are
> already running in parallel in this repo. This handoff opens a
> third lane (**C**) scoped narrowly to read-mostly LLM batch work
> that won't conflict with A or B's files.

## Mission

Two batched LLM jobs, both running through the local Claude CLI shim
(Max-20x sub OAuth) at `http://127.0.0.1:5051` so neither burns the
Anthropic API. Idempotent — safe to re-run.

**Task 1 — `other`-bucket expansion (re-classify).** Current state:
9,980 active jobs are 100% classified into the 7-value `role_category`
enum, but **90% (8,999) landed in `other`** because the enum was too
narrow. Expand the classifier to 16 values, re-classify only the
`other` rows, leave the 981 fitting-bucket rows untouched.

**Task 2 — Layer-3 backfill.** Layer-3 enrichment ran once and left
huge NULL rates: `level` 49%, `visa_sponsorship` 92%, `salary_min`
83%, `years_min` 32%, `city` 43%. Backfill these from the JD text
via Haiku-4.5. Per-column where-clause so we never re-extract a
populated cell.

## TL;DR

- **Live app:** `https://career-buddy.enigkt1.workers.dev`
- **Repo root:** `/Users/troelsenigk/fa-track`. Branch `main`.
- **DB:** Supabase project `gxnpfbzfqgbhnyqunuwf`. `.env` configured
  (`SUPABASE_DB_URL` etc.) — `connect()` in `backend/career_buddy_
  scraper/db.py` already wraps it.
- **Claude shim:** `scripts/claude_cli_shim.py` listens on `:5051`,
  serves Max-20x sub OAuth. Verify with
  `curl -m 3 -s http://127.0.0.1:5051/health` before starting any
  batch run.
- **Session orchestration model:** **Sonnet 4.6** (`claude-sonnet-4-6`).
  Routine batch-job orchestration + CLI scripting + per-batch
  sample-check — Sonnet handles it cleanly. Do NOT start this
  session with Opus 4.7 (wastes Max-20x quota), do NOT start with
  Haiku 4.5 (too weak for rebase-conflict resolution + multi-step
  CLI orchestration).
- **Batch model (different layer!):** `claude-haiku-4-5-20251001`
  passed to `ClaudeCli(model=...)` for the per-job classification
  calls. Haiku is the right tool for the 16-value classification
  task + Layer-3 extraction. Do NOT swap to Sonnet or Opus for the
  batch calls — burns sub quota for negligible quality gain.
- **Tests:** 260 frontend (vitest), 258 backend (pytest). Keep green.
- **Last commit on origin/main:** see `git log --oneline -1`.

## Hard rules (DO NOT VIOLATE)

- **No Anthropic API auto-pay.** Claude calls only via local shim
  `:5051` (Max-20x sub OAuth). The existing `ClaudeCli` in
  `backend/career_buddy_scraper/claude_cli.py` already enforces this.
- **No Gemini paid auto-fallback.** 429 surfaces cleanly.
- **No destructive bulk SQL.** Always include scoped `WHERE` clauses:
  - Task 1 SELECT: `WHERE is_active=true AND role_category='other'`
  - Task 2 SELECT: `WHERE is_active=true AND <column> IS NULL`
  - All UPDATEs: same WHERE + id-keyed by uuid.
- **No git push without explicit user "ja"** unless the durable
  `Bash(git push:*)` permission rule is in
  `.claude/settings.local.json` (it currently is — verify on first
  push attempt).
- **Pull `--rebase`** before any push to surface A's / B's commits.
- **Subject lines** must describe the diff.

## What's YOURS (session C territory)

- `backend/career_buddy_scraper/cli/classify_tier2_claude.py` — extend
  with `--mode={tier2,subcategory,layer3}` (or new files; your call).
- `backend/career_buddy_scraper/cli/layer3_backfill.py` — new file.
  Adapt the existing Layer-3 patterns from `cli/classify.py` /
  `classify_tier2.py`.
- `data/migrations/0013_role_subcategory.sql` + supabase mirror IF
  you decide to widen the column constraints. **Most likely NO
  migration needed** — `jobs.role_category` is already plain `text`
  (no CHECK constraint), so new sub-values land without a schema
  change. **Verify first** with
  `psql ... -c "\d jobs"` before assuming.
- `audit/classify_subcat-<ts>.csv` + `audit/layer3_backfill-<ts>.csv`
  audit trails — same pattern the existing classify CLI uses.

## What's NOT yours (DO NOT TOUCH)

- `src/**` entire frontend tree — A + B own. Don't open these files
  except read-only to understand types.
- `supabase/migrations/*` — B owns (mirror dir for data/migrations).
  You CAN add a mirror file if you ship a real migration; B will
  pick up next round.
- `supabase/functions/*` — B / A coordinate via announce.
- `src/integrations/supabase/types.ts` — B regenerates.
- `vitest.config.ts`, `playwright.config.ts`, `tests/**` — B owns.
- `docs/HANDOFF_*.md` (other than this file) — owned by source.
- `CLAUDE_COORDINATION.md` — read-only for you. Append a `## C session
  (session 3 — classify + backfill)` row to the active-sessions table
  when you start; don't edit A / B's rows.
- `WORKPLAN-cinema-*.md` — A's file; ignore.

## Task 1 — sub-category expansion

### Proposed new enum (16 values total)

Existing 7 (KEEP — UI already reads these):

```
founders-associate · bizops · strategy · bd · chief-of-staff ·
investment-analyst · other
```

New 10 (expand the `other` bucket):

```
engineering          · software engineers, eng managers, infra/devops
product              · product managers, product analysts
design               · UX/UI, product designers, visual, brand
data-science         · ML engineers, data scientists, AI research,
                       data engineers
marketing            · growth, content, brand, PMM (product
                       marketing), demand gen, SEO
sales                · AE, BDR, sales engineers, account managers
                       (distinct from BD = partnerships)
customer-success     · CSM, support, technical account managers
recruiting-people    · talent, people ops, HR, comp & benefits
finance-legal        · accounting, controller, FP&A, GC, paralegal,
                       compliance
operations           · IT ops, eng ops, security ops, facilities
                       (distinct from bizops which is strategic ops)
```

Plus `other-misc` as a residual for things that genuinely don't fit
(executive-coach roles, unique research positions, etc.). **Total 17
values** including the 6 fitting + `other-misc`. **Drop the bare
`other` value once backfill completes** so the UI doesn't show a
mixed bucket.

### Prompt sketch for the LLM call

Lift the existing `classify_tier2_claude.py` system prompt + extend
with the 10 new categories. Each value gets a 1-line definition (see
above table) so Haiku can disambiguate. Same XML-wrap +
prompt-injection guard the existing CLI uses (`<job id="N">`).

### Where-clause + idempotency

```sql
SELECT id, role_title, requirements, description
FROM jobs
WHERE is_active = true
  AND role_category = 'other'
ORDER BY id
LIMIT %s
```

UPDATE writes new sub-category back to `role_category` and stamps
`classified_at = now()`. Drop the bare `other` for jobs that
successfully mapped; keep `other-misc` for the residual.

### Quota guards

Same as existing CLI: `--limit`, `--batch-size 30`, `--max-per-day`,
`--timeout-minutes`, `--dry-run` default. Audit CSV.

### Expected output

- 8,999 jobs re-classified across 11 buckets (10 new + `other-misc`).
- Estimated batch volume: 8,999 / 30 per batch ≈ 300 Claude calls.
- Estimated wall-clock at ~5s/call: 25 minutes.
- Audit CSV: `audit/classify_subcat-<ts>.csv` with columns
  `id,old_category,new_category,confidence,source,written_at`.

## Task 2 — Layer-3 backfill

### Columns to backfill (priority order)

| Column | NULL count | NULL % | Notes |
|---|---|---|---|
| `level` | 4,933 | 49% | junior/mid/senior/lead/principal/exec enum |
| `years_min` / `years_max` | 3,218 / ? | 32% | "3+ years" → 3 min |
| `city` | 4,302 | 43% | extract from location text |
| `visa_sponsorship` | 9,262 | 92% | inferred — "no sponsorship", "US-only", "EU work auth required" |
| `salary_min` / `salary_max` / `salary_currency` | 8,366 | 83% | range or single-point + currency |

### One LLM call per job, batched

Same XML-wrap pattern. Prompt asks Haiku to extract **only the NULL
fields it can confidently fill**. Schema-mode JSON output. Server
clamps numeric values (years 0–50, salary 1k–10M, drop obvious
hallucinations).

### Where-clause variants

Run per column to keep batches small + idempotent. Example for
`level`:

```sql
SELECT id, role_title, requirements, description, location
FROM jobs
WHERE is_active = true
  AND level IS NULL
ORDER BY id
LIMIT %s
```

UPDATE only the NULL column. **Never overwrite a populated cell** —
this is the contract that lets crash-mid-run resume cleanly.

### Sub-prompts per column

- **`level`**: classify into the enum `intern | junior | mid | senior
  | lead | principal | executive`. Default `null` if unclear (do NOT
  guess — keep NULL so the next backfill iteration can retry).
- **`years_min` / `years_max`**: regex preferred ("3+ years" / "5–7
  years" / "minimum 4 years"). LLM only if regex fails.
- **`city`**: extract from `location` text. Already partially
  populated; backfill the 43%.
- **`visa_sponsorship`**: tri-state `true | false | null`.
  - `true` when JD says "we sponsor visas", "H1-B sponsor",
    "we'll help with relocation"
  - `false` when JD says "no sponsorship", "must have US work auth",
    "EU residency required"
  - `null` otherwise (most cases — don't infer)
- **`salary_min` / `salary_max` / `salary_currency`**: extract
  numeric range + ISO currency code from JD text. Skip when not
  mentioned. Most EU JDs have nothing; most US JDs have a range.

### Quota guards

Same shape as Task 1. Add `--column={level,years,city,visa,salary}`
flag so the user can prioritize.

### Expected output

- Highest-yield run: `level` backfill (4,933 rows, ~165 batches).
- Lowest-yield: `visa_sponsorship` (most stay NULL; that's expected
  + correct — don't pad it with bad inferences).
- Audit CSV per column: `audit/layer3_backfill_<column>-<ts>.csv`.

## Coverage expansion (DEFERRED — DO NOT START)

The user asked why we only have 9,980 jobs. Investigation:

| Gap | Volume | Effort |
|---|---|---|
| 209 VCs scraped, only **104 produce active jobs** — 50% adapter-broken | +5–10k jobs | Fix existing adapters; 1–2d |
| Only **3 ATS** (Greenhouse 57%, Ashby 33%, Lever 10%) — missing Workday, BambooHR, SmartRecruiters, Personio (DE), JOIN.com | +5–15k jobs | New adapters; 3–5d each |
| No accelerator pipelines (YC ~3k, Techstars ~3.5k, Antler, EF, 500 Global, On Deck) | +50–100k jobs | New ENTITIES type + adapters; 1w |
| No job aggregators (Wellfound, WeWorkRemotely, RemoteOK, Welcome to the Jungle) | +20–50k jobs | New scraper class; 3–5d |
| No corporate-VC arms (GV, M12, Intel Capital, Salesforce Ventures, NVIDIA Inception) | +3–5k jobs | Add to VC seed; 1d |
| No DE/EU-specific VCs (Cherry, Earlybird, Speedinvest, Project A, HV, Picus, Visionaries) | +1–3k DACH jobs | Add to VC seed; 1d |

**Do NOT touch this in session C.** Logged here so the user can
spawn a session D for it. This is a separate, big-scope effort —
new ATS adapter classes need test coverage + skip-probe logic.

## Verification block (paste at start)

```bash
cd /Users/troelsenigk/fa-track
git pull --rebase origin main
git log --oneline -5

# Claude shim health (REQUIRED for the batch runs)
curl -m 3 -s http://127.0.0.1:5051/health
# If shim down: ask user to start it. Don't fall back to API.

# DB sanity
cd backend
uv run python -c "
from career_buddy_scraper.db import connect
with connect() as conn, conn.cursor() as cur:
    cur.execute(\"select count(*) from jobs where is_active=true and role_category='other'\")
    print('other-bucket:', cur.fetchone()[0])
    cur.execute(\"select count(*) from jobs where is_active=true and level is null\")
    print('level NULL:', cur.fetchone()[0])
"
# Expected: other-bucket ≈ 8999, level NULL ≈ 4933.

# Test suites green
uv run pytest -q | tail -2          # 258 passed
cd .. && bun run test | tail -3     # 260 passed
```

If anything ≠ green: STOP, ask user. Don't ship destructive runs
on a broken rig.

## Working order

1. Read this doc top to bottom.
2. `git pull --rebase origin main`.
3. Add yourself to `CLAUDE_COORDINATION.md` "Active sessions" table
   as session C (one commit, just docs).
4. **Task 1 first** (sub-categories) — higher user-visible signal,
   smaller blast radius. Build the prompt, run `--dry-run` on 30
   rows, eyeball the sub-category assignments, then run for real.
5. **Audit pass** — sample 50 random newly-assigned rows from each
   new bucket. Sanity-check.
6. **Task 2 next** — `level` first (biggest yield), then
   `years_min`, then `city`, then `visa_sponsorship`, then
   `salary_*` (most stays NULL — that's fine).
7. Push commit-by-commit; A + B may need to pull mid-flight.
8. **Final**: update `CLAUDE_COORDINATION.md` with sub-category
   counts + Layer-3 backfill counts. Sync trigger if A wants to
   show new sub-categories in the UI filter chips.

## What you do NOT do (cross-session boundary)

- Don't touch frontend (`src/**`).
- Don't add new VC adapters or expand coverage (deferred — separate
  session D).
- Don't run Gemini batches (Free Tier daily quota is finite + B
  may be using it).
- Don't migrate the `role_category` column to a hard enum (the UI
  reads string values; keep flexible until A signals).
- Don't squash audit CSVs into git (gitignore `audit/`).

## Memory pointers

- `~/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md` is
  auto-loaded into every conversation.
- `CLAUDE_COORDINATION.md` — boundary contract.
- `docs/HANDOFF_2026-05-10_NEW_SESSION.md` — B's hand-off (for context).
- `docs/HANDOFF_UI_2026-05-10_evening.md` — A's hand-off (for context).

## Sync triggers — when to ping back

- After Task 1 dry-run sample (50 rows). Show new sub-category
  counts; user decides if the split is the right shape.
- After Task 1 real run completes. Sub-category counts go in the
  coord doc; A may want to add sub-cat filter chips to `/jobs`.
- After Task 2 `level` backfill completes. Big jump in job-fit
  scoring quality.
- Any blocker / unexpected DB shape / shim down.
