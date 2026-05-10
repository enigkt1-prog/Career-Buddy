# HANDOFF — Career-Buddy new Claude Code session (2026-05-10 ~09:30 CEST)

> Drop into a fresh chat. Read top-to-bottom before doing anything.
> Previous session reached 72% context after a marathon overnight build.

## TL;DR

- **Live:** https://career-buddy.enigkt1.workers.dev (Cloudflare Workers + Supabase Postgres `gxnpfbzfqgbhnyqunuwf`)
- **Repo root:** `/Users/troelsenigk/fa-track`. Branch `main`. **All commits pushed.**
- **Last commit:** `d30205a` — iter-2 schema + Claude CLI shim
- **Tests:** backend 94 / 94 pass. ruff clean. mypy --strict clean.
- **Deployed Supabase edge functions:** `analyze-cv`, `match-job`, `draft-message`, `chat`. All Gemini-2.5-flash; 4-h cooldown on 429.
- **Active background process on this machine:** `python3 scripts/claude_cli_shim.py` (PID 17704, listens :5051). Browser `/chat` route detects it via `/health` and prefers it over Gemini.
- **Cloudflare deploy:** auto-builds on push. Last push (d30205a) building when session ended.

## Active in Supabase

- `jobs` table — 9,980 active rows.
- description coverage 99.98%, requirements 53%.
- Layer-3 Regex enrichment (commit `479f6b0` + `35aab70` + `d30205a`):
  - years_min/max — 6,762 (68%)
  - salary_min/max + currency — 1,614 (16%, post-tightening)
  - languages_required[] — 1,207 (12%)
  - level (enum) — 5,047 (51%)
  - country — 7,947 (80%)
  - city — sub-set of country
  - visa_sponsorship — 718 (7% explicit yes/no)
  - is_international — 804 (8%)
- role_category — 402 (4%) — Tier-2 stuck on Gemini quota; can finish when quota refreshes.

## Last 22 commits this run

```
d30205a feat: iter-2 schema (level/country/city/visa/intl) + Claude CLI shim
d565f9b feat(vcs): skip_probe flag — systematic out-of-scope blacklist  (other session)
efac01b feat: navigation + chat route (multi-page IA, iter 1)
b5b834f fix(review): apply Codex re-review findings on Phase A/B/C
c6442bd …
```

(Earlier ones in `docs/HANDOFF_OVERNIGHT_2026-05-09.md`.)

## Frontend feature inventory

- **Top nav** (`src/components/Nav.tsx`): Overview / Profile / CV / Chat. Profile + CV are anchor scrolls on `/`. Chat is `/chat`.
- **Overview** (`src/components/CareerBuddy.tsx`, mounted on `/`):
  - Profile section (chat input + Edit Profile modal + CV upload + analyze-cv flow)
  - Applications tracker (inline status edit, next-action edit, delete, notes, URL link, Supabase sync via `client_id`)
  - Insights panel (real data: funnel / top category / location concentration / profile-gap nudge / recency / high-fit pile)
  - Roles grid: 30 of top-fit jobs from 60 fetched. Filters bar (role-cat, ATS, location, posted-since, remote, languages, max-years, level, country, visa, multi-country, sort, presets). Chips on cards (ats, role_category, level, years, salary, visa, multi-country, languages, recency).
  - Per-card buttons: Add to tracker / ✍️ Draft (cover letter modal) / Analyze fit (Gemini match-job) / Dismiss.
- **Chat** (`src/routes/chat.tsx`): grounded chat. Probe-toggles between local Claude-CLI shim (preferred) and Gemini Supabase function. localStorage history + 4-h Gemini quota cooldown.

## Hard rules — DO NOT VIOLATE

- **No Anthropic API auto-pay paths.** Claude calls only via the local shim → user's Max-20x OAuth Claude Code session.
- **No Gemini paid auto-fallback.** 429 surfaces cleanly to UI.
- **No git push without explicit user authorization** (the user did authorize the overnight build with "mache alle schritte" — that license was scoped to that night).
- **No destructive bulk SQL** on Supabase without scoped where-clause. Migrations and per-row updates only.

## Open / pending

1. **Tier-2 reclassify** on the 9,578 `role_category IS NULL` rows. Stuck on Gemini quota; CLI also tapped out yesterday. Run `bash scripts/morning_check.sh` once Gemini API quota resets (~midnight Pacific) to mop up.
2. **CareerBuddy.tsx is ~3,200 lines.** Iter 3 plan: split into `routes/index.tsx` (overview) + `components/roles/` + `components/applications/` + `components/profile/`. Will halve initial bundle.
3. **Real `/profile` + `/cv` routes** (currently anchor scrolls). Same Iter 3 split unblocks this.
4. **Visa / level / international** are regex-only and shallow. Iter 4: Gemini batch enrichment to refine ambiguous rows once quota allows.
5. **Multi-user auth** + RLS — single-user app today. Separate phase when needed.
6. **Real Gmail integration** — Sync Inbox button removed; OAuth + IMAP + label-based status update is its own phase.

## Architecture cheat-sheet

```
src/
├── components/
│   ├── CareerBuddy.tsx              ~3.2k lines, all current overview UI
│   └── Nav.tsx                       4-tab top nav (anchors + /chat)
├── routes/
│   ├── __root.tsx                    renders <Nav/> above <Outlet/>
│   ├── index.tsx                     mounts <CareerBuddy/>
│   └── chat.tsx                      chat UI, shim probe, Gemini fallback
├── integrations/supabase/
│   ├── client.ts                     supabase-js singleton (Vite env vars)
│   └── types.ts                      regenerated against gxnpfbzfqgbhnyqunuwf
└── lib/cv-parser.ts                  pdfjs + mammoth dynamic imports

backend/career_buddy_scraper/
├── ats/{greenhouse,lever,ashby,workable,personio,recruitee,gemini_fallback}.py
├── descriptions.py                   raw_payload → description + requirements
├── jd_attrs.py                       regex extractors (years, salary, lang, level, country, visa)
├── orchestrator.py                   per-VC fetch → normalize → upsert
├── jobs_repo.py                      UPSERT + mark_stale + count_active
├── classify.py                       Tier-1 regex categorisation
└── cli/
    ├── scrape.py                     entry for nightly cron
    ├── backfill_descriptions.py      raw_payload → description (no HTTP)
    ├── enrich_jobs.py                regex Layer-3 attrs
    ├── classify_tier2.py             Gemini-graded role_category
    └── migrate.py                    runs data/migrations/*.sql against Supabase

supabase/functions/
├── analyze-cv/index.ts               CV → structured analysis (Gemini)
├── match-job/index.ts                profile + job → fit grading (Gemini)
├── draft-message/index.ts            kind in {cover_letter, outreach, feedback_request, thank_you, follow_up}
└── chat/index.ts                     stateless chat (Gemini)

scripts/
├── morning_check.sh                  smoke-test all 4 edge fns + run Tier-2
└── claude_cli_shim.py                local :5051 → claude CLI (Max-sub OAuth)

data/migrations/
├── 0001_layer0_baseline.sql          users / applications / events / vc_jobs
├── 0002_layer1_scraper.sql           vcs / jobs
├── 0003_job_dismissals.sql           dismissed-job persistence
├── 0004_jd_attrs.sql                 years / salary / languages columns
├── 0005_apps_client_id.sql           client_id for applications sync
└── 0006_jd_more_attrs.sql            level (enum) / country / city / visa / international
```

## Quick verification (paste into new session before doing anything)

```bash
cd /Users/troelsenigk/fa-track
git status                              # should be clean
git log --oneline -5                    # latest is d30205a
curl -m 3 -s http://127.0.0.1:5051/health   # {"ok": true} if shim running
curl -sI https://career-buddy.enigkt1.workers.dev/ | head -3  # 200
cd backend && uv run pytest -q | tail -2
```

## How user wants you to work

- **Caveman mode** is the default. Drop articles/filler/hedging. Fragments OK. Code/commits/security: write normal English/German.
- **Plan reviews** with Codex (or Gemini if available) before execution; iterate until **10/10**, not "≥8/10".
- **Code review** the diff after each phase.
- Push permission: get explicit "ja" before each push unless user says "make alle schritte".
- Claude CLI shim path is the canonical Claude integration. **Never** propose adding `ANTHROPIC_API_KEY` flows.

## Memory pointers

- `~/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md` (always loaded)
  - `project_overnight_2026_05_09.md` — last night's build
  - `project_career_buddy_live_2026_05_09.md` — live deploy details
  - `feedback_supabase_first.md` — Supabase as source of truth
  - `feedback_career_buddy_tracking.md` — three-lane tracking
  - `project_round3_scrape_20260509.md` — 9,980 jobs

## Where to start in the new chat

1. **Read this doc.**
2. Read the user's most recent ask (will be in the new prompt).
3. Run the verification block above.
4. **Do not** auto-restart the shim — it's already running. If `curl 127.0.0.1:5051/health` fails, then start it: `python3 scripts/claude_cli_shim.py`.

## What this session learned the hard way

- Don't accept "8/10" or "9/10" from reviewers when the user said 10/10. Iterate.
- Parallel sub-agents (Codex `task --write`) can write into the same file behind your back. Saw a CompletenessMeter / job_dismissals migration appear without warning. Read fresh after dispatching.
- Gemini Free Tier is **20 RPD** on `gemini-2.5-flash`, not the 1500 the docstring claimed. Budget runs accordingly.
- Cloudflare Workers Builds: `Variables and Secrets` (runtime) ≠ `Build` → `Build variables and secrets`. Vite needs the latter at build time.
- Salary regex without explicit currency anchor over-fits. Always require currency in the match window.
- TanStack Start hydration: `useState(() => loadState())` mismatches when localStorage is non-empty. Seed empty, hydrate in `useEffect`.
