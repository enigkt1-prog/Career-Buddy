# 0003 — Python + uv for Layer-1 scraper

- **Status:** Accepted
- **Date:** 2026-05-08
- **Deciders:** Project lead

## Context

Layer 1 (per `scraper-plan.md`) replaces the hardcoded `vc_jobs.json` fixture with a daily-refreshed database of 2,000–5,000 operator/FA roles scraped from VC and portfolio career pages. The build needs:

- HTTP client with async support (Greenhouse/Lever/Ashby/Workable APIs benefit from concurrency).
- HTML parsing fallback for the ~30% of career pages not on a known ATS.
- Optional headless-browser fallback (Playwright) for JS-rendered Webflow/Framer pages.
- Cron scheduler running daily.
- LLM call for Tier-2 role classification on ambiguous titles.

The Lovable frontend is React/TypeScript. The natural assumption is to keep the scraper in TypeScript too. The scraper is, however, an isolated service: it writes to Supabase, the frontend reads from Supabase, no shared code.

## Decision

Layer-1 scraper is a Python 3.11 project managed with `uv`.

- Project root: `backend/` with its own `pyproject.toml`.
- HTTP: `httpx` (async).
- HTML: `selectolax` (fast, no JS).
- JS-rendered fallback: Playwright Python (only when needed; defer until a custom-page case actually requires it).
- Storage client: `supabase-py`.
- LLM client: `anthropic` (claude-haiku-4.5 for Tier-2 classification, cheap + deterministic enough).
- Scheduler: GitHub Actions cron, daily 00:00 UTC.
- Lint/format: `ruff` + `ruff format`.
- Type-check: `mypy --strict` on `backend/`.

## Consequences

**Positive:**
- Aligns with the user's stated Python-3.11-with-uv preference (global CLAUDE.md). Familiar stack means faster iteration.
- Scraping ecosystem maturity: `selectolax` and `httpx` are best-in-class, no TS-equivalent matches them.
- LLM-classification step uses the official Anthropic Python SDK, which has the cleanest streaming/caching ergonomics for the Tier-2 batch job.
- Isolated service boundary (Supabase Postgres) means the Python/TS split has zero shared-code cost.

**Negative:**
- Two languages in the repo. Onboarding cost for someone who only knows one. Mitigated: scraper docs are in `scraper-plan.md`, the frontend never imports scraper code.
- Cannot reuse Lovable-generated TypeScript types in the scraper. Acceptable: the canonical schema lives in `data/schema.sql` and a hand-maintained `backend/career_buddy_scraper/models.py` mirrors it.

**Neutral:**
- GitHub Actions cron is free and version-controlled. If run-time exceeds Actions limits (currently >6h per job), migrate to Modal or Railway. Cost cap: <$10/mo at 20k rows.

## Alternatives considered

- **TypeScript with Bun + undici + linkedom.** Keeps the stack monolingual. Rejected because Python's scraping ecosystem (Beautiful Soup → selectolax pipeline, mature ATS-API client patterns, Playwright Python) is materially better for this workload, and the user has stronger Python fluency for backend work.
- **Bash + curl + jq.** Tempting for the four ATS endpoints (all return JSON). Rejected because the Tier-2 LLM classification step, dedup logic across investors, and the Supabase upsert flow would balloon shell scripts past their reasonable size.
- **n8n / Zapier / no-code.** Rejected: 4 ATS adapters + LLM classification + dedup is not a no-code workload. The visual editors hide errors that compound at 5,000-row scale.
- **Hand-curated CSV refreshed weekly.** Doable for v0.1 but kills the daily-refresh promise that makes Career-Buddy better than a Notion table.
