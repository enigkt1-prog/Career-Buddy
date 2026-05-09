# HANDOFF — Career-Buddy migration to new Claude Code chat (2026-05-09)

> Read end-to-end before doing anything. Context is heavy; previous
> session ended at 77% context to migrate to fresh chat.

## TL;DR — what state is the project in

- **Live URL**: not deployed yet. Plan is Cloudflare Pages.
- **Repo**: github.com/enigkt1-prog/Career-Buddy (public, 25 commits ahead of original baseline)
- **Layout**: monorepo. Frontend at root (TanStack Start + Vite). Backend in `/backend/` (Python 3.11 + uv).
- **Supabase**: gxnpfbzfqgbhnyqunuwf (user-owned, troelsenigk@mail.de account). 3,849 active jobs, 125 vcs, 223 ICP-relevant operator-roles classified. Schema applied via `data/migrations/0001_layer0_baseline.sql` + `0002_layer1_scraper.sql`.
- **Lovable**: dropping. Old project (xrfzgluntpbkseabirpt) is in Lovable's Supabase-org; user has zero direct access. Lovable Cloud not abandonable; just stop using it.
- **Tests**: 56 / 56 passing, ruff clean, mypy --strict clean.

## Stack decision (final)

```
Frontend         Vite + TanStack Start + React + shadcn-ui (already in repo)
Hosting          Cloudflare Pages (auto-deploy from git push)
DB + Auth        Supabase Postgres (gxnpfbzfqgbhnyqunuwf)
Edge functions   Cloudflare Workers (preferred) or Supabase Edge Functions
Scraper          Python 3.11 + uv. Schedules: GitHub Actions cron daily.
LLM inference    Gemini Free Tier (15 RPM / 1500 RPD on gemini-2.5-flash).
                 Hard rule: NEVER auto-fallback to paid Anthropic / Gemini.
Mobile (later)   PWA first (manifest + service-worker on web app).
                 React Native + Expo only when push / native APIs are
                 actually needed.
```

## What's already built and committed

### Backend (`/backend/`)

- 6 ATS adapters: Greenhouse, Lever, Ashby, Workable, Personio, Recruitee
- HTTP client: `RateLimitedClient` (token-bucket 100 req/min, 200 ms per-host sleep, 4-h disk cache)
- Orchestrator: per-VC fetch → normalize → validate → upsert
- Discovery: HTML-scan for ATS embeds + slug-variant probe (`cli/discover_slugs.py`)
- Gemini fallback adapter (`ats/gemini_fallback.py`) — opt-in via `GEMINI_FALLBACK_ENABLED=1`
- Tier-1 regex classifier + Tier-2 LLM classifier (`cli/classify_tier2.py`)
- Migration runner (`cli/migrate.py`)
- Reporting (`cli/report.py`, `cli/scrape.py`, `cli/seed_notion.py`, `cli/preflight.py`)
- 56 tests (unit + adapter contract + Workable pagination + HTML discovery + live DB)

### Frontend (root)

- TanStack Start + Vite scaffold (Lovable-generated, kept as starting point)
- shadcn-ui components in `src/components/ui/` (~50 components)
- Main app shell: `src/components/CareerBuddy.tsx` (Layer-0 mock-mode UI)
- CV-parser: `src/lib/cv-parser.ts`
- Supabase client: `src/integrations/supabase/client.ts` (env-var driven)
- Edge function: `supabase/functions/analyze-cv/index.ts` (CV analysis)
- Cloudflare deploy config: `wrangler.jsonc`

### Schema + Data

- `data/migrations/0001_layer0_baseline.sql` — users, applications, events, vc_jobs
- `data/migrations/0002_layer1_scraper.sql` — vcs, jobs, updated_at trigger
- `supabase/migrations/<ts>_*.sql` — same migrations renamed for Supabase CLI
- 3,849 jobs live in Supabase (Greenhouse 1960, Ashby 1126, Lever 763)

### Docs

- `docs/decisions/0001-mock-mode-layer-0.md`
- `docs/decisions/0002-three-lane-tracking.md`
- `docs/decisions/0003-python-uv-scraper.md`
- `docs/decisions/0004-supabase-as-source-of-truth.md`
- `docs/scraper-plan.md` — Layer-1 architecture
- `docs/HANDOFF_GEMINI_SCRAPER_2026-05-09.md`
- This file

## URGENT — running background process when you start

A `discover_slugs` round-3 expansion is running in the background with the
ENTITIES list expanded from 126 → 206 (added ~80 high-volume operator-
startups: Scale AI, Glean, Sierra, Harvey, Mercury, Brex, Rippling, Deel,
Snowflake, Databricks, MongoDB, HashiCorp, Cloudflare, Aleph Alpha,
HelloFresh, Delivery Hero, Zalando, Klarna dup, Lovable, etc.).

Process PID: 33653 (parent shell + uv subprocess). Started ~20:23 CEST
2026-05-09. Cache TTL 4 h had expired so all probes hit network. ETA:
~80 min total = finish ~21:40 CEST.

Wait-loop watching the PID: bash task bw4ydp8q4 — will notify when 33653
exits. Output: `/tmp/discover-r3.log`.

When you start the new session:

1. Check process: `ps -p 33653 -o pid,etime,state`
2. Tail log: `tail -30 /tmp/discover-r3.log`
3. If still running, wait or `kill 33653` if user wants to abandon.

When the process exits (or you kill it):

```bash
cd /Users/troelsenigk/fa-track/backend

# Re-run scrape with expanded vcs base. Will fetch from any new ATS slugs
# the discovery just pinned, plus update existing.
uv run python -m career_buddy_scraper.cli.scrape

# CRITICAL: deactivate the Notion Labs contamination AGAIN (it comes back
# every time discovery is re-run because the slug matches `notion`).
# Use this scoped UPDATE — it's safe per workplan whitelist.
uv run python <<'PY'
from career_buddy_scraper.db import connect
with connect() as conn:
    with conn.cursor() as cur:
        cur.execute("""
            update jobs set is_active = false
             where company_domain = 'notion.vc'
               and ats_source = 'ashby'
               and is_active = true;
        """)
        n = cur.rowcount
        cur.execute("""
            update vcs set careers_url = 'https://notion.vc'
             where domain = 'notion.vc';
        """)
    conn.commit()
print(f"deactivated: {n}")
PY

# Then Tier-1 + Tier-2 classify (Tier-2 needs GEMINI_API_KEY in .env)
uv run python -m career_buddy_scraper.cli.classify
uv run python -m career_buddy_scraper.cli.classify_tier2

# Generate final report
uv run python -m career_buddy_scraper.cli.report
```

Expected outcome: from 3,849 active jobs → 4,500-6,500 active jobs after
the round-3 expansion (the 80 new entities should add 500-2,500 jobs
between them, with Stripe-class companies dominating).

After that: commit + push the round-3 results, then update this handoff
doc with the final totals.

## What's NOT done — next session priorities

1. **Drop Lovable, deploy frontend to Cloudflare Pages.**
   - User creates Cloudflare account (free): https://dash.cloudflare.com/sign-up
   - Cloudflare → Workers & Pages → Create → Connect to Git → enigkt1-prog/Career-Buddy
   - Build cmd: `bun run build`. Output dir: `.output/public` (TanStack Start) — verify with `bun run build` locally first.
   - Env vars in Cloudflare Pages: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` (values: gxnpfbzfqgbhnyqunuwf + its anon key from `.env`).
   - Verify boot at career-buddy.pages.dev.

2. **Wire frontend to live `jobs` table.**
   - Currently `CareerBuddy.tsx` reads `public/data/*.json` fixtures.
   - Replace with Supabase query: `supabase.from('jobs').select('*').eq('is_active', true).order('posted_date', { ascending: false, nullsFirst: false }).limit(30)`.
   - Show: company_name, role_title, location, ats_source as a badge, posted_date as "X days ago".
   - Top-3 fit-glow can stay hardcoded or move to client-side scoring.

3. **Regenerate `src/integrations/supabase/types.ts`** against gxnpfbzfqgbhnyqunuwf.
   - Command: `npx supabase gen types typescript --project-id gxnpfbzfqgbhnyqunuwf > src/integrations/supabase/types.ts`
   - Requires Supabase access token (user gets from Supabase dashboard → Account → Access Tokens).

4. **Re-deploy `analyze-cv` Edge Function** to gxnpfbzfqgbhnyqunuwf.
   - Repo's `supabase/config.toml` is currently set to `xrfzgluntpbkseabirpt` (was reverted for Path A; needs flip back to `gxnpfbzfqgbhnyqunuwf`).
   - Command: `npx supabase functions deploy analyze-cv --project-ref gxnpfbzfqgbhnyqunuwf`.

5. **PWA conversion** (after the above is stable).
   - Add `public/manifest.webmanifest` + service-worker via `vite-plugin-pwa`.
   - Test "Add to Home Screen" on iOS Safari + Android Chrome.

6. **Backend cron**: schedule `cli/scrape.py` to run daily.
   - GitHub Actions: `.github/workflows/scrape.yml`, cron `0 4 * * *` (4 am UTC).
   - Uses `SUPABASE_*` secrets stored in GitHub Actions secrets.
   - Free 2,000 min/month.

7. **Tier-2 classifier finish-pass** — 3,787 rows still `tier2_pending`.
   - Re-run `uv run python -m career_buddy_scraper.cli.classify_tier2`.
   - Previous run hit Gemini CLI 120s timeout; should now complete in batches.

## Hard rules (do not violate)

- **No Anthropic API auto-pay paths.** User has Max 20x sub via OAuth; scripts use Gemini Free Tier or local Claude Code session, not API-keyed Anthropic clients.
- **No Gemini paid auto-fallback.** `QuotaExhausted` must surface; never wrap with billing-API retry.
- **Gemini fallback opt-in only** (`GEMINI_FALLBACK_ENABLED=1`).
- **Budget cap respected** (`GEMINI_FALLBACK_MAX_PER_RUN`, default 50).
- **No destructive SQL without scoped where-clauses.** Whitelisted in workplan.
- **No git push without user authorization.** Always confirm before pushing.
- **No edits to `/backend/` from the frontend Lovable workspace.** They're separate concerns.

## Current local state (machine)

- Repo path: `/Users/troelsenigk/fa-track`
- Branch: `main` — 4 commits ahead of origin (last push 12:12 CEST 2026-05-09)
- `.env` at root — has gxnpfbzfqgbhnyqunuwf credentials, APIFY_TOKEN, GEMINI_API_KEY
- Backend `.venv` at `/Users/troelsenigk/fa-track/backend/.venv` (uv-managed)
- Cache at `artifacts/cache/` (gitignored, 4-h TTL)
- Migration bundle CSVs at `artifacts/migration-bundle/` (gitignored, 52 MB jobs.csv)

## Memory pointers

- `/Users/troelsenigk/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md`
- Especially: `feedback_supabase_first.md`, `feedback_career_buddy_tracking.md`, `project_overnight_scrape_20260508.md`

## Where everything lives

- Career-Buddy code: `/Users/troelsenigk/fa-track/`
- Engineering KB (broader context): `/Users/troelsenigk/Engineering_Playbook/11_AI_Agents_Landscape/`
- Obsidian vault for ideation: `/Users/troelsenigk/Startup_Ideation_Vault/01_Ideas/Career Buddy.md`
- Notion (Karriere workspace) — operational data (own job applications, VC pages)

## Decision log (last 24 h)

- 2026-05-08 evening: overnight Layer-1 build, 17 → 3,849 active jobs, 6 codex review iterations
- 2026-05-09 morning: Tier-2 classifier ran (161 matched), Gemini fallback wired
- 2026-05-09 midday: Lovable monorepo merge attempted, Lovable refused subdir, force-pushed to founder-trackr → renamed to Career-Buddy → archived old Career-Buddy
- 2026-05-09 afternoon: Lovable Cloud lock-in confirmed, decided to drop Lovable, switch to Cloudflare Pages
- 2026-05-09 ~14:00 CEST: handoff to new chat written (this file)
