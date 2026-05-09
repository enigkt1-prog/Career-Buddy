# Hand-off: Gemini Job-Scraper Integration (2026-05-09)

> **For another Claude Code session continuing Career-Buddy work.**
> Read this end-to-end before suggesting changes. Cost-discipline matters.

## What was built

A Gemini-powered job-extractor that runs as a **fallback** in the existing
Career-Buddy scraper. Used only when the standard ATS detection
(`_resolve_provider`) returns None (i.e. a VC's careers page is not
Greenhouse/Lever/Ashby/Workable/Personio/Recruitee).

Cost contract (hard rules — do not change without user approval):

```
Tier 1: ATS adapter (existing, free, structured)  ← primary
Tier 2: Gemini Free API (15 RPM, 1500 RPD)        ← fallback
Tier 3: gemini CLI (user's Pro/Ultra subscription) ← second fallback
Tier 4: STOP — raise QuotaExhausted, NEVER auto-pay
```

User has Anthropic Max 20x sub for Claude Code itself. Refuses pay-as-you-go
API on any provider. Browser/scrape work goes to Gemini Free Tier so it
does not eat the Anthropic quota used for coding.

## Files added / changed

- **`scripts/scraper/career_buddy_scraper/gemini_scraper.py`** (new)
  - `GeminiScraper` class with 3-tier fallback chain.
  - CLI entrypoint: `python -m career_buddy_scraper.gemini_scraper --url <url>`.
  - Uses new `google-genai` SDK (not deprecated `google-generativeai`).

- **`scripts/scraper/career_buddy_scraper/ats/gemini_fallback.py`** (new)
  - `try_gemini_extract(...)` — wrapper used by orchestrator.
  - `GeminiFallbackBudget` — per-run cap (default 50) to prevent eating Free Tier
    on bad data.
  - `is_enabled()` — gated by `GEMINI_FALLBACK_ENABLED=1`.
  - Maps Gemini raw-dicts → `CanonicalJob` (`ats_source=AtsSource.CUSTOM`).

- **`scripts/scraper/career_buddy_scraper/orchestrator.py`** (modified)
  - When `_resolve_provider` returns None AND fallback is enabled → tries Gemini.
  - On success: counted as `vcs_matched`, `by_provider["gemini"]`, joins
    `touched` set with `(domain, "custom")`.
  - On failure / budget-out / quota: counted as `gemini_fallback_skipped`,
    falls through to existing `unmatched` logic.
  - New stats fields: `gemini_fallback_attempted`, `gemini_fallback_succeeded`,
    `gemini_fallback_jobs`, `gemini_fallback_skipped`.
  - run-stats JSON now includes a `gemini_fallback` block.

- **`scripts/scraper/pyproject.toml`** (modified)
  - New dependency group: `gemini = ["google-genai>=0.3"]`.
  - Sync with: `uv sync --group gemini`.

- **`scripts/scraper/career_buddy_scraper/README_gemini.md`** (new)
  - Setup + usage doc for the standalone Gemini scraper.

- **`.env`** (modified — local only, gitignored)
  - `GEMINI_API_KEY=` placeholder filled by user with real key.

- **`.env.example`** (modified)
  - `GEMINI_API_KEY` placeholder + comment about Free Tier + CLI fallback.

## How to use

### Run scrape WITHOUT Gemini fallback (default — identical to before)

```bash
cd /Users/troelsenigk/fa-track/scripts/scraper
uv run python -m career_buddy_scraper.cli scrape   # or whatever your CLI command is
```

### Run scrape WITH Gemini fallback (opt-in)

```bash
cd /Users/troelsenigk/fa-track/scripts/scraper
set -a; source /Users/troelsenigk/fa-track/.env; set +a
GEMINI_FALLBACK_ENABLED=1 \
  uv run python -m career_buddy_scraper.cli scrape
```

Optional: cap how many unmatched VCs get tried per run (default 50):

```bash
GEMINI_FALLBACK_ENABLED=1 GEMINI_FALLBACK_MAX_PER_RUN=10 \
  uv run python -m career_buddy_scraper.cli scrape
```

### Standalone Gemini-only run (debug a single page)

```bash
cd /Users/troelsenigk/fa-track/scripts/scraper
set -a; source /Users/troelsenigk/fa-track/.env; set +a
uv run python -m career_buddy_scraper.gemini_scraper \
  --url https://job-boards.greenhouse.io/anthropic --pretty
```

## Verification done so far

- ✅ Synthetic HTML test (2 jobs) — extracted correctly, locations + remote-flag right.
- ✅ Live Greenhouse test (Anthropic) — 5 jobs returned with title, URL, location,
  posted_date, is_remote. (Lazy-loading limits total jobs visible without JS render —
  Greenhouse should already use the JSON adapter, not Gemini, in production.)
- ✅ ruff + mypy clean for new files.
- ✅ Imports + structural smoke tests pass.
- ❌ NOT tested: end-to-end orchestrator run with `GEMINI_FALLBACK_ENABLED=1` against
  actual unmatched VCs in DB.

## What's NOT done (next steps for this hand-off)

1. **Live end-to-end test:**
   ```bash
   GEMINI_FALLBACK_ENABLED=1 GEMINI_FALLBACK_MAX_PER_RUN=10 \
     uv run python -m career_buddy_scraper.cli scrape
   ```
   Check `artifacts/run-stats-<timestamp>.json` for the new `gemini_fallback` block.
   Expected: some of the previously-unmatched VCs should now have jobs.

2. **Quality audit on Gemini output:**
   - Spot-check 5-10 jobs Gemini returned for: correct URL, real role_title, no
     hallucinated companies.
   - If hallucination detected: tighten prompt in `gemini_scraper.py:_build_prompt`.

3. **Integration into orchestrator's CLI:**
   - The CLI module under `career_buddy_scraper/cli/` may need a `--enable-gemini`
     flag exposed. Check `cli/__init__.py`. If not exposed, env var is the only
     control surface today.

4. **Daily-cron consideration (LATER, not now):**
   - User wants a 24/7 background scraper.
   - Use launchd or GitHub Actions, NOT a custom Python loop.
   - Cap runs to once every 4-6h. Free Tier is 1500 RPD — easily fits.

5. **Unmatched-VC playbook:**
   - For VCs that even Gemini can't parse: log to `unmatched_vcs_<ts>.json`,
     manually inspect, decide if site needs Playwright pre-render or should be
     skipped entirely.

## Hard rules (do not violate)

- **NO `ANTHROPIC_API_KEY` autopay paths.** User uses Max 20x subscription via
  OAuth. Workers and scripts should rely on local Claude Code session, not
  spin up new API-keyed Anthropic clients.
- **NO Gemini paid-tier auto-fallback.** `QuotaExhausted` must surface to caller.
  Never wrap it with retry-via-billing-API.
- **Gemini fallback opt-in only.** Default OFF. User must consciously enable.
- **Budget cap respected.** `GeminiFallbackBudget.take()` returns False after cap;
  caller logs as skipped and moves on.

## Where everything lives

- Career-Buddy code: `/Users/troelsenigk/fa-track/`
- Scraper module: `/Users/troelsenigk/fa-track/scripts/scraper/career_buddy_scraper/`
- Gemini files: `gemini_scraper.py`, `ats/gemini_fallback.py`, `README_gemini.md`
- Env: `/Users/troelsenigk/fa-track/.env` (gitignored, has real key)
- Engineering KB (broader context):
  `/Users/troelsenigk/Engineering_Playbook/11_AI_Agents_Landscape/`
  - Tools: `Coding-Agents/Gemini Computer Use.md`, `Codex Browser Use.md`
  - Trends: `Browser Agent Wave 2.md`
  - Use-Cases: `24-7 Job Posting Tracker.md`
- Memory pointers: `/Users/troelsenigk/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md`
  - Especially: `feedback_claude_flow_conservative.md` for cost-discipline rules.

## Context for the next session

User pivoted to this pattern after realizing they want **24/7 cost-zero job
scraping** for Career-Buddy without burning their Anthropic Max 20x quota
which is reserved for coding. The Gemini Free Tier solves this cleanly.

If the live test passes, the natural next move is wiring this into a daily
cron and adding a daily-digest email of newly-found jobs. But confirm the
live test works first before scaling.
