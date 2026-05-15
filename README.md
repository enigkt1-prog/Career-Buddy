# Career-Buddy

An AI-native career platform for people targeting **early-stage startup roles** (Founders Associate, BizOps, Investment Analyst, GTM). Aggregates roles from VC career pages, ATS systems, and aggregators into a single feed, classifies them by function and seniority, and helps a candidate run a structured job-search loop on top of it.

Career-Buddy is an **early build, actively developed**. Some of what you see here works end-to-end today; some is in progress; some is planned. The repository is honest about which is which.

---

## Why this matters

Breaking into early-stage startups as a generalist is a structurally broken job search:

- Open Founders Associate / BizOps / GTM-Associate roles are scattered across ~200 VC career pages, ~10 ATS systems, LinkedIn stealth posts, Antler/EF cohorts, and accelerator portfolios. No single feed covers them.
- Candidates lose track of their own pipeline across Gmail, LinkedIn DMs, Notion, and WhatsApp.
- Existing junior-job boards are chat-shaped but stateless: they forget context between messages, so the user re-explains themselves every session.

Career-Buddy is an attempt to combine **broad-coverage ingestion** (scraper + classifier) with **stateful candidate context** (Supabase-backed profile, applications, events) so the same loop can both surface roles and learn what's working.

---

## Current state

| Area | Status |
|---|---|
| Frontend (TanStack Start + Vite, deployed on Cloudflare Workers) | Live |
| Supabase Postgres schema + 17 numbered migrations | In place |
| VC + ATS scraper (Greenhouse, Lever, Ashby, Workable, Personio, Recruitee, Workday, SmartRecruiters + aggregator adapters) | Working, expanding coverage |
| Classifier pipeline (function, seniority, location, work-mode) | Working on the ingested corpus |
| Active-jobs corpus | Tens of thousands of rows, refreshed by recurring scrape |
| Multi-user auth (Supabase magic link + OAuth) | Shipped, hardening |
| Email-account OAuth (Gmail, Outlook) for application tracking | Phase 1 wired, deeper inbox parsing planned |
| CV upload + parser | Shipped end-to-end in mock mode; live mode wired through `analyze-cv` Edge Function |
| AI fit analysis + draft messages (cover letter, outreach, follow-up) | Edge Function shipped, UI surfaces in iteration |
| CV-radar dashboard, agentic chat write-actions, growth recommender | Planned |

The product is **not finished**. It is the kind of project a generalist operator builds while figuring out where the real pain sits.

---

## Architecture

```
                     ┌──────────────────────────────────────┐
                     │           Job sources                │
                     │  VC career pages · ATS APIs ·        │
                     │  aggregators (RemoteOK, WWR) ·       │
                     │  accelerator portfolios (YC, Antler) │
                     └──────────────────┬───────────────────┘
                                        │
                          ┌─────────────▼──────────────┐
                          │   Python scraper (uv)      │
                          │   per-source adapters →    │
                          │   normalize → validate     │
                          └─────────────┬──────────────┘
                                        │
                          ┌─────────────▼──────────────┐
                          │   Classifier pipeline      │
                          │   function · seniority ·   │
                          │   city · work-mode         │
                          └─────────────┬──────────────┘
                                        │
                          ┌─────────────▼──────────────┐
                          │   Supabase Postgres        │
                          │   (vcs · jobs · users ·    │
                          │   applications · events)   │
                          └─────┬──────────────┬───────┘
                                │              │
            ┌───────────────────▼──┐      ┌────▼─────────────────────┐
            │  Frontend (Vite +    │      │  Supabase Edge Functions │
            │  TanStack Start)     │      │  analyze-cv · match-job  │
            │  on Cloudflare Wkrs  │      │  draft-message · chat    │
            └──────────────────────┘      └──────────────────────────┘
```

Supabase is the API boundary. The scraper writes to Postgres; the frontend reads from Postgres and writes user-side state; Edge Functions sit between when CPU-bound or LLM-backed work needs server-side execution. There is no direct backend → frontend network call.

---

## Tech stack

- **Frontend**: TypeScript, React, TanStack Start, Vite, Tailwind, shadcn/ui
- **Backend (scraper)**: Python 3.11, `uv`, Pydantic, ruff + mypy strict, pytest
- **Database**: Supabase Postgres, numbered SQL migrations, row-level security
- **Serverless**: Supabase Edge Functions (Deno)
- **Deployment**: Cloudflare Workers (frontend), Supabase managed (DB + Edge Functions)
- **LLM providers**: Anthropic, OpenAI, Google (Gemini) — used through narrow server-side functions, not the browser
- **Tests**: ~140 backend test functions, ~350 frontend test cases (Vitest + RTL), Playwright smoke routes

---

## Repository layout

```
.
├── src/                          Frontend (TanStack Start)
│   ├── routes/                   File-based routes
│   ├── components/               UI: career-buddy, cinema, profile
│   ├── integrations/supabase/    Browser + server Supabase clients
│   └── lib/                      Domain helpers (cv-parser, profile-store, state)
├── supabase/
│   ├── config.toml
│   └── functions/                Edge Functions: analyze-cv, match-job, chat,
│                                 draft-message, email-oauth-{start,callback}
├── backend/                      Python 3.11 scraper + classifier
│   └── career_buddy_scraper/
│       ├── ats/                  ATS adapters (Greenhouse, Lever, Ashby,
│       │                         Workable, Personio, Recruitee, Workday,
│       │                         SmartRecruiters, aggregators, Gemini fallback)
│       ├── cli/                  scrape, classify, discover_slugs, migrate,
│       │                         preflight, report
│       ├── sources/              VC + accelerator seeds
│       ├── orchestrator.py       per-source fetch → normalize → validate → upsert
│       ├── jobs_repo.py          Postgres upsert + mark-stale
│       ├── classify.py           Regex Tier-1 classifier
│       └── gemini_scraper.py     LLM fallback extractor
├── data/
│   ├── migrations/               Canonical migration history (17 files)
│   ├── schema.sql                Baseline reference
│   └── *.json / *.txt            Anonymized fixtures for mock mode
├── docs/
│   ├── PRD.md / brief.md / build.md / design.md
│   ├── scraper-plan.md
│   └── decisions/                Architecture Decision Records (ADR-0001 … 0004)
├── public/                       Static assets
├── .env.example                  Shared env template (frontend + backend)
└── LICENSE
```

---

## Quickstart

### Frontend

```bash
bun install                       # or npm install
cp .env.example .env              # fill in VITE_SUPABASE_* keys
bun run dev                       # vite dev server on http://localhost:5173
```

### Backend (scraper)

```bash
cd backend
uv sync                           # install Python deps
uv run pytest                     # run test suite
uv run python -m career_buddy_scraper.cli.scrape   # live scrape (writes to Supabase)
```

### Supabase

Migrations are numbered SQL files in `data/migrations/`. Apply via the Supabase SQL editor or the CLI; see `docs/SETUP_MASTER_KEY.md` for the OAuth-token encryption setup.

---

## Roadmap

- [x] Layer 0 — Mock-mode MVP with end-to-end happy path
- [x] Layer 1 — Live VC + ATS scraper, classifier pipeline, Supabase as source of truth
- [ ] Layer 2 — CV coach, cover-letter + outreach drafting, interview prep, growth recommender
- [ ] Layer 3 — Persistent Career Buddy: switch-timing advice, salary negotiation, headhunter brokering, life-stage-aware coaching

Treat the roadmap as a direction, not a commitment. Layers 2 and 3 will likely change as the candidate-side loop teaches us what actually moves the needle.

---

## Responsible data use

This repository does **not** contain real user data, real CVs, real email contents, real credentials, or proprietary datasets. The fixtures in `data/sample_cv.txt` and `data/mock_emails.json` are anonymized templates used by the frontend's mock mode and the parser tests.

Future features that involve real user data — CV upload, email-account OAuth, application tracking — will require:

- Explicit user consent on connect (per provider, per scope)
- Encryption at rest for sensitive tokens (already implemented for OAuth refresh tokens via Supabase Vault + pgcrypto; see `docs/SETUP_MASTER_KEY.md`)
- Per-user data deletion, exported on request
- Row-level security on every multi-user table
- LLM calls scoped to the minimum payload needed and routed through server-side Edge Functions, never the browser

If you find a privacy or security concern, please open a GitHub issue or email the maintainer.

---

## Project documentation

| File | Purpose |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Long-form product requirements |
| [`docs/brief.md`](docs/brief.md) | Problem, primary user, core job, success criteria |
| [`docs/build.md`](docs/build.md) | Build scope and phased priority |
| [`docs/design.md`](docs/design.md) | Visual direction and design tokens |
| [`docs/scraper-plan.md`](docs/scraper-plan.md) | Scraper architecture |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |

---

## License

MIT — see [LICENSE](LICENSE).

<!-- deploy-check: 2026-05-15 -->

