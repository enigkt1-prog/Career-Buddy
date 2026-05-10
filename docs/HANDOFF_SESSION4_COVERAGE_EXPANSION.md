# HANDOFF — Career-Buddy SESSION 4 (coverage expansion)

> Fresh chat. Read this top-to-bottom before doing anything.
>
> Three other sessions are (or were) active in this repo: **A** = UI,
> **B** = backend + tooling, **C** = classify + Layer-3 backfill. This
> handoff opens a fourth lane (**D**) scoped to **scraper coverage
> expansion**: fixing broken VC adapters, adding new ATS adapters,
> wiring accelerator + job-aggregator pipelines, expanding the VC
> seed list.

## Mission

Lift Career-Buddy from **9,980 active jobs across 104 companies** to
a substantially larger pool by closing five concrete gaps. Each gap
is a separate atomic ship — pick one, finish + test + push, sync,
pick the next.

| Gap | Volume | Effort | Order |
|---|---|---|---|
| Broken VC adapters — 105/209 VCs produce 0 active jobs | +5–10k jobs | 1–2d | **1st** (smallest blast radius) |
| EU/DACH VC seed expansion — Cherry, Earlybird, Speedinvest, Project A, HV, Picus, Visionaries; corp VCs GV/M12/Intel Capital/Salesforce Ventures/NVIDIA Inception | +4–8k jobs (~2-3k DACH) | 1d | **2nd** (existing adapters, just seed file) |
| Accelerator pipelines — Y Combinator (~3k cos), Techstars (~3.5k), Antler, Entrepreneur First, 500 Global, On Deck | +50–100k jobs | 1w | **3rd** (largest hebel) |
| New ATS adapters — Workday, Personio (DE!), SmartRecruiters, JOIN.com, BambooHR | +5–15k jobs | 3–5d per adapter | **4th** (per-adapter shippable) |
| Job aggregators — Wellfound (ex-AngelList), WeWorkRemotely, RemoteOK, Welcome to the Jungle | +20–50k jobs | 3–5d | **5th** (lower fit-rate per job — noisier) |

## TL;DR

- **Live app:** `https://career-buddy.enigkt1.workers.dev`
- **Repo root:** `/Users/troelsenigk/fa-track`. Branch `main`.
- **DB:** Supabase project `gxnpfbzfqgbhnyqunuwf`.
- **Session orchestration model:** **Sonnet 4.6** (`claude-sonnet-4-6`).
  Adapter design + HTML/JSON parsing + new-class scaffolding +
  test coverage — Sonnet is the right tool. Do NOT start this
  session with Opus 4.7 (wastes Max-20x sub quota on routine
  scraper work). Haiku 4.5 too weak for HTML-shape inference +
  cross-adapter pattern matching.
- **Tests:** 258 backend pytest (keep green). Add new tests for
  every new adapter.

## Hard rules (DO NOT VIOLATE)

- **No new ATS-adapter ships without test coverage.** Every adapter
  gets pytest cases for: happy path (fixture JSON/HTML), empty
  results, 404, 429, malformed payload.
- **No git push without explicit user "ja"** unless the durable
  `Bash(git push:*)` rule is in `.claude/settings.local.json`
  (it currently is — verify first push).
- **Pull `--rebase` before any push.** A, B, C may all push in
  parallel.
- **`vcs.skip_probe` for unrecoverable broken VCs** — don't tolerate
  repeated noise (private API, unsupported ATS, removed careers
  page). Pattern lives in
  `~/.claude/projects/.../memory/feedback_scraper_systematic_fixes.md`.
- **Adapter expansion only when ≥3 VCs need it.** Don't write a
  one-shot adapter for a single VC's quirk. Same memory file.
- **No destructive bulk SQL.** WHERE-clause every UPDATE.
- **No new VCs in seed without manual validation** — check the
  careers-URL renders + the portfolio-URL lists companies. Bad
  seed entries pollute the scraper.

## What's YOURS (session D territory)

- `backend/career_buddy_scraper/adapters/*` — new files for new ATS
  adapters. Existing patterns: `greenhouse.py`, `ashby.py`,
  `lever.py`. Copy the shape.
- `backend/career_buddy_scraper/cli/scrape.py` — extend with new
  adapter wiring if needed.
- `backend/career_buddy_scraper/seeds/*` — VC seed file(s). Add new
  VCs + accelerators here.
- `backend/tests/*` — new tests for new adapters. Fixture JSON/HTML
  in `backend/tests/fixtures/`.
- `data/migrations/0013_<name>.sql` IF you need a new entity type
  (e.g. accelerator distinct from VC). Most likely **no migration
  needed** — `vcs` table is flexible enough. Verify first.

## What's NOT yours (DO NOT TOUCH)

- `src/**` entire frontend tree — A + B own.
- `supabase/migrations/*` — B owns the mirror dir.
- `supabase/functions/*` — A / B coordinate via announce.
- `src/integrations/supabase/types.ts` — B regenerates.
- `vitest.config.ts`, `playwright.config.ts`, `tests/**` (frontend
  e2e) — B owns.
- `backend/career_buddy_scraper/cli/classify*` + `cli/layer3_backfill*`
  — **session C territory**. If C is still running, don't touch.
- `docs/HANDOFF_*.md` (other than this file).
- `CLAUDE_COORDINATION.md` — append yourself as session D in active
  table; don't edit A/B/C rows.

## Gap 1 — Broken-VC-Adapter audit (start HERE)

### Diagnosis

```bash
cd /Users/troelsenigk/fa-track/backend
uv run python -c "
from career_buddy_scraper.db import connect
with connect() as conn, conn.cursor() as cur:
    cur.execute('''
        select v.name, v.domain, v.careers_url,
               (select count(*) from jobs j
                  where j.company_domain = v.domain
                    and j.is_active = true) as n_jobs
        from vcs v
        order by n_jobs asc, v.name
    ''')
    for r in cur.fetchall():
        print(f'{r[3]:5}  {r[0][:30]:30}  {r[1][:30]:30}  {r[2] or \"\"}')
"
```

You'll see ~105 VCs with `n_jobs = 0`. Per-VC diagnostic:

1. Hit the `careers_url` — does it load? (curl + status)
2. Hit the `portfolio_url` — does it list companies?
3. Identify the ATS (look at outgoing links — boards.greenhouse.io,
   jobs.lever.co, jobs.ashbyhq.com, workday-hosted, custom)
4. If our adapter supports the ATS — adapter is broken, fix.
5. If unsupported ATS — set `vcs.skip_probe = true` (don't waste
   future scrape cycles), add to "needs adapter X" backlog.
6. If careers/portfolio URL is dead — search current URL; update;
   if VC defunct, set `skip_probe = true`.

### Where-clause for skip_probe

```sql
UPDATE vcs SET skip_probe = true,
              notes = COALESCE(notes, '') || ' [skip: <reason>]'
WHERE domain = '<bad-vc-domain>';
```

### Output

Audit CSV `audit/vc_adapter_audit-<ts>.csv` with columns
`domain,name,old_status,new_status,reason,fixed`. Commit only the
seed/skip_probe SQL, not the CSV.

## Gap 2 — VC seed expansion (DACH + corporate VCs)

### Add to seed

Look at the existing seed file pattern (`backend/career_buddy_
scraper/seeds/*.py` or whatever the live shape is — read first).
For each VC:

- Name, domain
- Portfolio URL (where companies are listed)
- Careers URL (usually empty for VC itself — adapter walks the
  portfolio companies' careers pages)
- Geography tag
- Stage focus
- Sector tags

### VCs to add

**DACH-specific (highest priority — fills the user's geography):**
- Cherry Ventures (cherry.vc)
- Earlybird (earlybird.com)
- Speedinvest (speedinvest.com)
- Project A (project-a.com)
- HV Capital (hvcapital.com) — formerly Holtzbrinck
- Picus Capital (picus.capital)
- Visionaries Club (visionaries.club)
- Atlantic Labs (atlantic-labs.com)
- 468 Capital (468cap.com)
- Headline (headline.com) — formerly e.ventures

**Corporate VC arms (broader pool):**
- GV / Google Ventures (gv.com)
- M12 / Microsoft Ventures (m12.vc)
- Intel Capital (intelcapital.com)
- Salesforce Ventures (salesforceventures.com)
- NVIDIA Inception (nvidia.com/en-us/startups)
- Citi Ventures (citi.com/ventures)
- Sapphire Ventures (sapphireventures.com)
- Workday Ventures (workday.com/en-us/company/ventures.html)

**Top-tier US generalists if missing (check existing seed first):**
- a16z, Sequoia, Accel, Index Ventures, Greylock, Founders Fund,
  Khosla, Bessemer, Lightspeed, NEA, Insight Partners, Tiger Global,
  Coatue, Battery, GGV.

Validate each entry: portfolio URL renders AND has companies. Drop
seed entries that fail validation; don't let bad rows pollute the
scraper queue.

### Test

`uv run python -m career_buddy_scraper.cli.scrape --vc <new-domain>
--dry-run` should print job counts before the real run.

## Gap 3 — Accelerator pipelines

### Y Combinator first (largest hebel)

YC has a public Work-at-a-Startup job board with a documented
search API. Pattern:

1. Fetch the YC company list
   (`https://www.ycombinator.com/companies` or the WaaS endpoint).
2. For each YC company, link to its careers page (most use
   Greenhouse / Lever / Ashby — already supported).
3. Treat YC as a new "accelerator" entity type — either reuse the
   `vcs` table with `aum_bucket = 'accelerator'` (no migration) or
   add a new column / table if you need to disambiguate. **Default
   to reusing `vcs`**.

### Techstars, Antler, Entrepreneur First, 500 Global, On Deck

Each has a portfolio page. Pattern is identical to VC scraping —
crawl portfolio → company careers pages → existing ATS adapters.

### Risk

Accelerators frequently include companies that have shut down OR
become large public corps that the user wouldn't apply to. Add a
`stage_focus` filter on the scrape so only seed/series-A companies
pass through.

## Gap 4 — New ATS adapters

### Priority order

1. **Workday** — huge enterprise coverage, complex JSON. Pattern:
   `careers-{tenant}.wd5.myworkdayjobs.com` API. Public, no auth.
2. **Personio** — German market! `personio.com/<company>` careers
   page. HTML scrape, may need Playwright for JS-rendered pages.
3. **SmartRecruiters** — public API
   `api.smartrecruiters.com/v1/companies/{id}/postings`.
4. **JOIN.com** — DE market. HTML scrape, smaller adapter.
5. **BambooHR** — pattern `{company}.bamboohr.com/careers`.

### Each adapter follows the existing pattern

Look at `backend/career_buddy_scraper/adapters/ashby.py` for the
shape. Each adapter:
- Takes a careers URL or company ID
- Returns a list of `Job` dataclass instances
- Handles 404 + 429 + malformed payloads cleanly
- Logs failures with the VC domain for the audit trail

### Fixtures

Capture real responses as JSON / HTML fixtures in
`backend/tests/fixtures/<ats>/`. Five fixtures per adapter:
happy-path, empty, 404, 429, malformed. Match the pattern in
`tests/test_<existing>_adapter.py`.

## Gap 5 — Job aggregators (LAST, optional)

- **Wellfound** (ex-AngelList Talent) — has a public job search.
- **WeWorkRemotely** — RSS + HTML.
- **RemoteOK** — JSON API.
- **Welcome to the Jungle** — DACH + FR market, HTML.

These are noisier (lower fit-rate per job, more spam) than the
VC-portfolio pipeline. **Only ship after Gaps 1–4 land** so the
quality bar is set first.

## Verification block (paste at start)

```bash
cd /Users/troelsenigk/fa-track
git pull --rebase origin main
git log --oneline -5

# DB sanity
cd backend
uv run python -c "
from career_buddy_scraper.db import connect
with connect() as conn, conn.cursor() as cur:
    cur.execute('select count(*) from vcs')
    print('vcs total:', cur.fetchone()[0])
    cur.execute('select count(distinct company_name) from jobs where is_active=true')
    print('producing companies:', cur.fetchone()[0])
    cur.execute('select count(*) from jobs where is_active=true')
    print('active jobs:', cur.fetchone()[0])
"
# Baseline: vcs 209, producing 104, active 9,980. Lift these numbers.

# Tests green
uv run pytest -q | tail -2
```

If anything ≠ green: STOP. Ask user.

## Working order

1. Read this doc + `CLAUDE_COORDINATION.md` + the two existing
   handoffs (`HANDOFF_2026-05-10_NEW_SESSION.md`,
   `HANDOFF_UI_2026-05-10_evening.md`) for context.
2. `git pull --rebase origin main`.
3. Append session D to the active-sessions table in
   `CLAUDE_COORDINATION.md`. Commit + push that one-line edit.
4. **Gap 1 first** — broken-adapter audit. Smallest blast radius,
   ships in 1–2 sessions of work.
5. After Gap 1: sync update for the user. New `producing-companies`
   count is the headline metric.
6. **Gap 2** — VC seed expansion. Run scrape against new seed
   entries.
7. **Gap 3** — Y Combinator first (biggest single hebel). Then the
   other accelerators.
8. **Gap 4** — Workday adapter first, then Personio (DACH), then the
   rest in priority order.
9. **Gap 5** — only after Gaps 1–4 are live.

Push commit-by-commit. A + B + C may need to pull mid-flight.

## What you do NOT do (cross-session boundary)

- Don't touch frontend (`src/**`).
- Don't run LLM classifier batches (session C's job; if C is done,
  you can trigger a one-off re-classify of newly-scraped jobs
  through the existing CLI but **don't extend the classify CLI
  itself**).
- Don't change Gemini / Anthropic / shim integration.
- Don't migrate the `vcs` table to add an `accelerator` enum unless
  you've checked + decided it's necessary (default: reuse
  `aum_bucket`).
- Don't ship adapter code without test fixtures + happy-path
  pytest coverage. The memory entry
  `feedback_scraper_systematic_fixes.md` says: "Don't tolerate
  repeated noise" — broken adapters that pass tests today but flake
  tomorrow are exactly that noise.

## Memory pointers

- `~/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md`
  is auto-loaded.
- `feedback_scraper_systematic_fixes.md` — `skip_probe` pattern +
  "adapter expansion ≥3 VCs" rule.
- `CLAUDE_COORDINATION.md` — boundary contract.
- `docs/HANDOFF_SESSION3_CLASSIFY_BACKFILL.md` — session C scope.

## Sync triggers — when to ping back

- After Gap 1 (broken-adapter fixes): new `producing-companies`
  count + sample of newly-active VCs.
- After Gap 2 (seed expansion): DACH-specific job count delta.
- After Gap 3 part 1 (YC pipeline): total jobs delta + sample of
  Founders-Associate / BizOps roles surfaced.
- Per new ATS adapter ship: pytest pass + first real scrape count.
- Any unrecoverable VC / new tooling decision (e.g. need Playwright
  for Personio).
