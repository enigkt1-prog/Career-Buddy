# 0001 — Mock-mode for Layer 0 hackathon build

- **Status:** Accepted
- **Date:** 2026-05-07
- **Deciders:** Project lead

## Context

Career-Buddy Layer 0 ships at the Lovable Future Founders Series Berlin hackathon (2-hour build window, 3-minute lightning demo to VC/tech judges). Live LLM calls, OAuth setups, and real scrapers each carry non-trivial failure modes inside that window: Google-Cloud-Console for Gmail OAuth alone consumes 30–60 min, OpenAI/Anthropic rate-limits or quota issues can blow up a live demo, real PDF parsing has edge cases that don't survive a 90-second walkthrough.

The hackathon judges are evaluating product clarity and founder energy, not infrastructure depth. Demo determinism is more valuable than demo realism.

## Decision

Layer 0 runs entirely in mock mode:

- No live API calls of any kind. No OpenAI / Anthropic / Claude / GPT / LLM connectors. No API keys.
- No Supabase Auth, no Supabase Storage, no Google login, no email APIs, no real PDF parsing, no URL fetching.
- All "AI" output is deterministic. Every visible string is hardcoded in the build prompt or read literally from `/data/mock_emails.json` and `/data/vc_jobs.json`.
- Persistence: `localStorage` only (key `"career-buddy-state"`).
- Supabase tables exist in the repo schema (`/data/schema.sql`) but are out of scope for Layer 0 runtime.
- One visible status pill `"Mock AI mode · cached demo responses"` makes the constraint explicit; otherwise no LLM-provider names appear in UI, comments, or variable names.

## Consequences

**Positive:**
- 60–90 second walkthrough runs identically on any laptop, any network, any time of day.
- Build window stays inside 2 hours; no setup tax for OAuth / API keys / scrapers.
- Demo wow-moment ("Sync Inbox" → 8 cached emails fan out → 6 applications change status with purple flash → summary strip lands) is fully scripted.
- No risk of leaking provider names in generated code that would tie the project to a specific vendor narrative early.

**Negative:**
- Layer 0 does not validate the actual hard parts: real-mail classification, real-JD-parsing, fit-scoring on real data. Those slip to Layer 1.
- Reviewers who poke under the hood will see hardcoded fixtures. The visible mock pill mitigates this — we are explicit, not deceptive.
- A working Layer-1 build cannot reuse Layer-0 React component contracts that assume `localStorage` and inline JSON; Supabase wiring is a separate Phase E task in `scraper-plan.md`.

**Neutral:**
- The mock-mode fixtures (`mock_emails.json`, `vc_jobs.json`) become the canonical contract. Any future real-data ingestion must produce records that match those shapes, which is also captured in the `CanonicalJob` schema in `scraper-plan.md`.

## Alternatives considered

- **Half-mock with one live LLM call.** Tempting (use Claude for one auto-classification to feel real). Rejected because a single live call still requires a key in the demo machine, still has a network failure mode, and the 250ms-stagger animation already carries the wow-moment without needing real inference.
- **Real Gmail OAuth + cached responses.** Burns 30–60 min on Google-Cloud-Console alone for a feature that does not differentiate the demo.
- **Skip the demo entirely and ship a working Layer-1 backend.** Trades the validation event (live judges, audience for distribution) for unvalidated backend work. Layer-1 ships in 4 weeks regardless; the hackathon window is one-time-only.
