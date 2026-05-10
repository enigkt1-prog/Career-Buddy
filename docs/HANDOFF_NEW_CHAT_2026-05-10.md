# HANDOFF — Career-Buddy migration to new Claude Code chat (2026-05-10)

> Read end-to-end. Previous session ended at 72% context; everything below
> is the live state at hand-off time (09:31 CEST).

## TL;DR — what state is the project in

- **Live URL**: https://career-buddy.pages.dev (Cloudflare Workers/Pages)
- **Repo**: github.com/enigkt1-prog/Career-Buddy (public)
- **Layout**: monorepo. Frontend at root (TanStack Start + Vite). Backend in `/backend/` (Python 3.11 + uv).
- **Supabase**: gxnpfbzfqgbhnyqunuwf
- **Branch**: main, sync'd with remote at commit `d565f9b` plus everything pushed by the parallel "overnight build" session.
- **Active jobs**: 9,980 (after Notion Labs cleanup).
- **Tests**: 94 / 94 passing (added 2 new regression tests this session).
- **Edge functions**: analyze-cv ✓, match-job ✓, draft-message ✓ — all 200 today.

## What this session did

### 1. Round-3 scrape (carried over from yesterday)

Previous chat ran `discover_slugs` round-3 (ENTITIES 126→206→213) overnight,
and this session woke up at the moment it completed. Then ran:

- `cli.scrape` (one transient `psycopg.errors.DeadlockDetected` retry — succeeded second time): 112/209 VCs matched, 10,120 rows fetched, 6,131 inserted, 3,989 updated. Active jobs **3,849 → 10,121**.
- Notion Labs ashby contamination: 141 rows deactivated again. Final active = **9,980**.
- `cli.classify` (Tier-1 regex): +72 matched.
- `cli.classify_tier2` (first attempt, evening 2026-05-09): blocked by Gemini Free Tier 20-RPD quota (MiroFish runs earlier ate it). Got 4 updated + 496 "other" before stopping cleanly.
- Commit `3fd5fd0 docs(handoff): round-3 scrape results` — pushed.

### 2. Bug fix: `boards-api.greenhouse.io` parsed as slug

The bare-subdomain regex `(?P<slug>[a-z0-9-]+)\.greenhouse\.io` matched
`boards-api.greenhouse.io` and captured "boards-api" as the slug. This
produced fake `(provider=greenhouse, slug=boards-api)` errors for any
careers page that referenced the Greenhouse API URL — observed on
anduril.com and glean.com.

Fix in `backend/career_buddy_scraper/discovery.py` and
`backend/career_buddy_scraper/ats/greenhouse.py`:

1. Added explicit `boards-api.greenhouse.io/v\d+/boards/(?P<slug>...)` pattern.
2. Tightened the bare-subdomain pattern with negative lookahead excluding reserved subdomains: `boards-api`, `boards`, `api`, `app`, `www`, `jobs`, `talent`, `careers`.

Two regression tests added in `tests/test_discovery.py`. Confirmed no
fake rows were ever inserted (the boards-api API itself 404'd before
insert). Commit `c6442bd fix(discovery): boards-api.greenhouse.io no longer parsed as slug` — pushed.

### 3. Systematic blacklist: `vcs.skip_probe`

Some VCs have ATS boards that exist in HTML but cannot be scraped via
public API (Ashby private API, Zoho Recruit / unsupported ATS, JS-only
render). Re-running discover_slugs cannot fix these — the API is the
problem, not slug discovery. Logging them every scrape adds noise without action.

Migration `0007_vc_skip_probe.sql` (also mirrored to `supabase/migrations/20260510080000_vc_skip_probe.sql`):

- `vcs.skip_probe BOOLEAN DEFAULT false`
- `vcs.skip_reason TEXT` — free-text audit
- Partial index on `skip_probe = false`

`orchestrator._load_vcs_with_careers_url` now filters `skip_probe = false`.
discover_slugs upsert preserves the flag (not in `on conflict` column list).

Initial blacklist (manual SQL):

- `11x.ai` → "ashby board private (api 404, graphql null) — not scrapeable via public api"
- `500.co` → "zoho recruit unsupported by current adapters; lever 404 stale"

Commit `d565f9b feat(vcs): skip_probe flag — systematic out-of-scope blacklist` — pushed.

### 4. Morning check (in progress at hand-off)

`bash scripts/morning_check.sh` started 09:07 CEST after the Gemini
Free Tier daily quota reset (00:00 PT = 09:00 CEST). Background task
`bw4oiikno`; full log `/tmp/morning_check.log`.

So far:

- analyze-cv → HTTP 200 ✓
- match-job → HTTP 200 ✓
- draft-message → HTTP 200 ✓
- "✓ All edge functions healthy."
- Tier-2 reclassify started against 9,578 pending titles. Batch progress at hand-off (09:31 CEST):

| Batch | Updated | Other |
|-------|---------|-------|
| 0-500 | 10 | 490 |
| 500-1000 | 0 (JSON parse error) | 500 |
| 1000-1500 | 21 | 479 |
| 1500-2000 | 30 | 470 |
| 2000-2500 | 39 | 461 |
| 2500-3000 | 11 | 489 |
| 3000-3500 | 20 | 480 |
| 3500-4000 | 13 | 487 |
| 4000-4500 | **113** | 387 |
| 4500-5000 | 20 | 480 |
| 5000-5500 | 26 | 474 |
| 5500-6000 | 20 | 480 |
| 6000-6500 | 11 | 489 |
| 6500-7000 | 41 | 459 |

Running total at hand-off: ~375 updated, ~6,625 classified-as-other,
~2,500-3,000 still to process. Expected ~6 more batches before either
quota hits or all 9,578 are done.

When the new session starts, **first action** is:

```bash
ps -p $(pgrep -f classify_tier2 | head -1) -o pid,etime,state
tail -50 /tmp/morning_check.log
```

If the process has exited, the final lines will include
`Tier-2 done: updated <N>, classified-as-other <M>, quota-hit=...`
followed by `→ Counts` and `jobs.is_active = ..., role_category specific = ...`.
Update the headline numbers in this doc.

## Stack decision (unchanged)

```
Frontend         Vite + TanStack Start + React + shadcn-ui
Hosting          Cloudflare Workers (live)
DB + Auth        Supabase Postgres (gxnpfbzfqgbhnyqunuwf)
Edge functions   Supabase Edge Functions (analyze-cv, match-job, draft-message)
Scraper          Python 3.11 + uv. GitHub Actions cron (4 am UTC).
LLM inference    Gemini Free Tier (20 RPD on gemini-2.5-flash).
                 NEVER auto-fallback to paid Anthropic / Gemini.
Mobile           PWA (manifest + service worker live).
```

## Hard rules (do not violate)

- **No Anthropic API auto-pay paths.**
- **No Gemini paid auto-fallback.** `QuotaExhausted` must surface; never wrap with billing-API retry.
- **Gemini fallback opt-in only** (`GEMINI_FALLBACK_ENABLED=1`).
- **No destructive SQL without scoped where-clauses.**
- **No git push without user authorization.** Always confirm before pushing.

## Systematic patterns to default to (NEW from this session)

When a VC's careers page has an ATS embed but the API 404s / returns
null / is unsupported (e.g. Ashby private board, Zoho Recruit, JS-only
render), use these in order — never just log and move on:

1. **`vcs.skip_probe` flag** (zero-code, immediate, reversible). Migration `0007` already provides it.
2. **Adapter expansion** when ≥3 VCs need it (Zoho Recruit, SmartRecruiters, Teamtailor, Workday). Each adapter ~3-5h.
3. **Multi-page HTML-discovery** (`/jobs`, `/about`, `/team`, anchor fragments) — current `discover_ats` only scans `careers_url`.
4. **`vc_overrides` table** for direct-ATS slug pinning when the auto-discovered slug differs from reality.
5. **Browser automation** (Playwright) — last resort.
6. **Web-search fallback** (Gemini-grounded) — costs quota; skip until adapter expansion exhausted.

Memory pointer: `feedback_scraper_systematic_fixes.md`.

## What's NOT done — next session priorities

1. **Verify Tier-2 final outcome** (per the bash command above); update
   the headline `role_category` coverage % once `morning_check.sh` exits.
2. **Update HANDOFF doc** with final Tier-2 numbers + commit + push.
3. **Re-run report** (`uv run python -m career_buddy_scraper.cli.report`)
   to see post-Tier-2 distribution. Currently the report's "Findings"
   block has stale text from the 17-job era — needs a rewrite.
4. **Decide on Zoho Recruit adapter** — only one VC (500.co) needs it
   today. Defer until ≥3 VCs need it.
5. **Multi-page HTML-discovery** — would unlock 11x.ai if the JS-rendered
   board exposed an iframe somewhere accessible.
6. **Frontend WIP** in `src/components/CareerBuddy.tsx` from a parallel
   session is uncommitted (~24 lines). Not in this session's scope.
7. **GitHub Actions cron** — `.github/workflows/scrape.yml` runs at
   `0 4 * * *` UTC. Should also add a daily classify_tier2 job after the
   scrape completes, scheduled after Free Tier reset.

## Repo state at hand-off

```
$ git log --oneline -8
d565f9b feat(vcs): skip_probe flag — systematic out-of-scope blacklist
c6442bd fix(discovery): boards-api.greenhouse.io no longer parsed as slug
[various commits from parallel "overnight build" session]
3fd5fd0 docs(handoff): round-3 scrape results — 9,980 active jobs
71f261b feat: AI per-job fit analysis (Phase C, match-job edge function)
8cdbf16 feat(frontend): JD-text keyword-overlap signal in fitScore (Phase B)
b86fda8 feat(scraper): backfill jobs.description + requirements
5fdf95a feat: profile editor + CV-driven fit-score + Gemini analyze-cv
```

Local branch up to date with origin/main.

Uncommitted:
- `src/components/CareerBuddy.tsx` — ~24 lines from parallel session, not mine.

## Memory pointers

- `/Users/troelsenigk/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md`
- New this session:
  - `project_round3_scrape_20260509.md`
  - `feedback_scraper_systematic_fixes.md`

## Background processes still running at hand-off

- `bw4oiikno` — `morning_check.sh` (Tier-2 reclassify in batches). ETA ~3-5 min remaining if quota holds; otherwise stops cleanly.
- Monitor `bgl11n00t` watching `/tmp/morning_check.log`. May fire stale events into the new session — ignore the timeout notification.

Pop these from the new session's task list once Tier-2 exits.
