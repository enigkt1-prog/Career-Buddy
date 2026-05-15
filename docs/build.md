# build.md — Career-Buddy

> **Lovable convention:** this is the durable build scope and order. Every implementation step must check this file. If a request is out of scope or violates the build order, flag it before building.

## Stack

- **Frontend.** React + Tailwind (Lovable-generated).
- **Persistence.** `localStorage` (single source of truth for Layer 0). Key: `"career-buddy-state"`. Persist applications array + profile + sync-completed flag. Restore on page load.
- **Data fixtures.** `/data/mock_emails.json` and `/data/vc_jobs.json`. Read literally; do NOT classify or infer.
- **No backend at runtime.** Supabase tables exist in the repo schema (`/data/schema.sql`) but are out of scope for Layer 0.

## Hard constraints (never violate)

- No live API calls. No OpenAI / Anthropic / Claude / GPT / LLM connectors. No API keys.
- No Supabase Auth. No Supabase Storage. No Google login. No email APIs. No real PDF parsing. No URL fetching.
- All "AI" output is deterministic.
- No references to OpenAI, Anthropic, GPT, Claude, or any LLM provider in generated app UI, code comments, variable names, or user-facing strings — except the visible status pill `"Mock AI mode · cached demo responses"`.

## Phased build priority (interpret literally)

### Phase 1 — absolutely must ship (target: first 60 min)

- Section 0 — Sticky header (logo, mock pill, reset link).
- Section 1 — Onboarding & Profile (chat input + canned reply + profile card; CV textarea + canned analysis).
- Section 2 — Applications Tracker (8 pre-seeded rows, Add-Application modal, Sync Inbox with stagger animation + summary strip).
- Section 5 — Career-Buddy Vision Strip (compact footer).

### Phase 2 — should ship (target: 60–90 min)

- Section 3 — Insights Panel (3 hardcoded bullets + refresh shimmer).

### Phase 3 — nice-to-have (target: 90–105 min, only if Phase 1+2 fully working)

- Section 4 — VC Jobs Feed (15 cards, top-3 glow computed from fit, Add-to-tracker).

If the build is not converging cleanly, drop Section 4 first, then Section 3. **Never drop Section 2's Sync Inbox** — that is the demo's single most important feature.

## Screens & primary user flows

Single-page app. No routing. Five sections stacked vertically (see `design.md` layout grid).

### Flow 1 — first-run demo arc (60–90s)

1. Page loads → tagline + 8 pre-seeded applications visible immediately.
2. User types into onboarding chat → click "Build profile" → 600ms spinner → canned reply + profile card render.
3. User pastes CV text into textarea → click "Analyze CV" → 800ms simulated delay → canned analysis block appends to profile card.
4. User clicks "+ Add Application" → modal → submit → 700ms simulated delay → new row appears at bottom of tracker (status=applied, fit=8.4, next_action="Prep B2B-deal example").
5. User clicks "Sync Inbox" → button enters loading state for 2000ms with spinner + "Scanning 8 cached emails…" → 8 rows update in stagger order with 250ms gap, each receiving a 400ms `bg-purple-100` flash → summary strip lands at t=2200ms.
6. Profile card collapses to its one-line summary. "Edit profile" link re-expands.
7. User scrolls to Insights panel (Phase 2) → 3 hardcoded bullets visible.
8. User scrolls to VC Jobs Feed (Phase 3) → 15 cards, top-3 glow.
9. Vision strip closes the pitch.

### Flow 2 — reload

- On reload with existing `localStorage` state, render the populated app (Sections 2–5 visible).
- Profile card collapsed if Sync was already run; expanded otherwise.
- Onboarding chat input still visible at the top so judges can see the full arc on first run.

### Flow 3 — reset

- "Reset demo" link in the header clears `localStorage`, reloads the page, and restarts the full onboarding flow from scratch.

## Core features (v1 only)

### F1 — Onboarding chat (Phase 1)

- Card with chat-style text input. Placeholder: `"Tell me what kind of role you want and your background."`
- Submit button: `"Build profile"`.
- On submit (any non-empty text): 600ms spinner inside button → render canned assistant reply in a chat bubble below the input → render Profile Card (expanded form).
- **Canned assistant reply (verbatim):**
  > "Got it. Target: Founders Associate at AI-startups + Operating Associate / BizOps / Strategy roles at early-stage startups. Geo: Berlin / Remote-DACH. Background: Strategy graduate, business track, 0–2y experience."

### F2 — Profile card (Phase 1)

**Expanded form** (default after first submit, and on reload if Sync hasn't run):

```
Name:        Sample Candidate
Target Role: Founders Associate / Operating Associate
Target Geo:  DACH (Berlin / Remote)
Background:  Strategy graduate, business track
Strong:      B2B-sales, structured thinking
Gap:         SaaS-metrics, ML fundamentals
```

**Collapsed form** (after Sync runs once):

```
Sample Candidate · Founders Associate · Berlin / Remote-DACH · Strategy graduate
```

with an `"edit profile"` link (`text-xs`, accent-colored, underline) that re-expands the card.

### F3 — CV paste-zone (Phase 1)

- Below the profile card: `<textarea rows=4>` labeled `"Paste your CV text"`.
- Below it: button `"Analyze CV"`.
- **Trigger:** button click only. No auto-trigger on text length.
- On click: 800ms simulated delay → APPEND to the profile card a "CV analysis" block with this exact text:
  > Strong: B2B-sales, structured thinking.
  > Gap: SaaS-metrics, ML fundamentals.
  > Recommend: SaaStr-basics module before next interview.
- Never attempt real PDF/text parsing.

### F4 — Applications tracker (Phase 1)

Card-styled table. Columns: Company | Role | Status | Last Event | Next Action | Fit.

**Pre-seed 8 rows on first load:**

| # | Company          | Role                   | Status   | Last Event | Next Action          | Fit |
|---|------------------|------------------------|----------|------------|----------------------|-----|
| 1 | Pedlar           | Founders Associate     | applied  | —          | Awaiting reply       | 7.2 |
| 2 | Avi              | Investment Analyst     | applied  | 2 days ago | Awaiting reply       | 8.4 |
| 3 | Rust             | Operating Associate    | applied  | 6 days ago | Awaiting reply       | 6.8 |
| 4 | Picus Capital    | FA Program             | applied  | —          | Awaiting reply       | 8.1 |
| 5 | Cherry Ventures  | Investment Analyst     | applied  | —          | Awaiting reply       | 7.4 |
| 6 | Project A        | Strategy Associate     | applied  | —          | Awaiting reply       | 7.9 |
| 7 | Earlybird        | Investment Analyst     | applied  | —          | Awaiting reply       | 6.5 |
| 8 | Speedinvest      | Investment Associate   | applied  | —          | Awaiting reply       | 8.7 |

**Controls (above table, right-aligned):**

- `+ Add Application` (secondary button — `bg-white border`).
- `Sync Inbox` (PRIMARY DEMO BUTTON — large, `bg-purple-600 text-white font-semibold px-6 py-2.5 rounded-lg shadow-md hover:shadow-lg`, with mail-icon left of label).

### F5 — Add Application modal (Phase 1)

- Fields: company, role, url (optional), applied_date (default = today, ISO format).
- Submit: 700ms simulated delay → append a new row with `status=applied`, `fit=8.4`, `next_action="Prep B2B-deal example"`.
- Do NOT fetch or parse the URL.

### F6 — Sync Inbox (Phase 1, the demo wow moment)

**Canonical email contract** — `mock_emails.json` has 8 entries. If file is missing or differs, use this list verbatim:

| # | matches_company  | expected_classification | subject (one-line)                                  |
|---|------------------|-------------------------|-----------------------------------------------------|
| 1 | Pedlar           | rejection               | Re: Founders Associate Application — Pedlar         |
| 2 | Avi              | interview-invite        | Avi Investment Analyst — next steps                 |
| 3 | Rust             | confirmation            | Application received — Operating Associate          |
| 4 | Picus Capital    | interview-invite        | Coffee chat — Picus Capital FA Program              |
| 5 | Cherry Ventures  | rejection               | Cherry Ventures Investment Analyst                  |
| 6 | Project A        | follow-up-question      | Quick question on your CV                           |
| 7 | Earlybird        | confirmation            | Earlybird Investment Analyst — application received |
| 8 | Speedinvest      | offer                   | Offer — Speedinvest Investment Associate            |

Each entry exposes: `matches_company`, `expected_classification`, `subject`, `body`, `date` (ISO), `from`. Read these fields literally.

**Row-change ledger (drives summary count):**

- 6 rows change status: Pedlar → rejected, Avi → interview-2, Picus Capital → interview-2, Cherry Ventures → rejected, Project A → follow-up-needed, Speedinvest → offer.
- 2 rows update only their last_event_date (status unchanged): Earlybird (confirmation), Rust (confirmation).
- Summary math: 8 emails scanned · 6 applications updated · 6 next actions created · 1 offer received.

**Classification → update mapping (deterministic, no inference):**

```
rejection           → status="rejected",         next_action="Ask for feedback (draft ready)"
interview-invite    → status="interview-2"        // intentional jump applied → interview-2 to signal a positive accelerated round
                        for matches_company="Avi": next_action="Thu 3pm CET market sizing case"
                        for matches_company="Picus Capital": next_action="Coffee chat — pick 3 slots"
follow-up-question  → status="follow-up-needed", next_action="Reply to Kim: B2B deal example"
offer               → status="offer",            next_action="Review offer letter — €52k base"
confirmation        → status unchanged (still "applied"); update last_event_date to email.date; next_action unchanged.
```

**Animation spec (declarative, one primitive):**

- On Sync click, button enters loading state for 2000ms. Inside button: small spinner + text `"Scanning 8 cached emails…"`.
- During the 2000ms window, walk through emails in this exact order with a 250ms stagger (first update at t=0, last at t=1750ms):
  1. Pedlar           → rejected
  2. Avi              → interview-2
  3. Picus Capital    → interview-2
  4. Cherry Ventures  → rejected
  5. Project A        → follow-up-needed
  6. Earlybird        → confirmation (no badge change, only last_event_date)
  7. Rust             → confirmation (no badge change, only last_event_date)
  8. Speedinvest      → offer
- Each row receives a single 400ms `bg-purple-100` flash (`transition-colors duration-[400ms] ease-out`), then settles to its new badge state and updated next_action text.
- One animation primitive across all rows. No typewriter, no scale tweens.

**Animation fallback (if Lovable's first generation produces broken stagger):**

- Acceptable: spinner runs for 2000ms, then ALL changed rows update simultaneously with a single 400ms purple-100 flash. Summary strip still renders. Fully acceptable v1.
- Refinement prompts can attempt the stagger upgrade later (see `refinement-prompts.md`).

**Summary strip (renders at t=2200ms, below the table):**

Full-width, `bg-gray-50`, `rounded-lg`, `px-4 py-3`, `text-sm`. Exact text:

> 8 emails scanned · 6 applications updated · 6 next actions created · 1 offer received

**Post-Sync profile collapse:** once Sync has run successfully, collapse the profile card to its one-line summary form.

### F7 — Insights panel (Phase 2)

- Right sticky sidebar, 1/3 width.
- Title (`text-base font-semibold mb-3`): `"Patterns"`.
- 3 hardcoded bullets (each in its own card: `bg-gray-50 rounded-lg p-4 mb-2`):
  - "B2B-focused VC roles respond 3× more than B2C — focus your pipeline."
  - "Picus Capital pipeline avg 21 days — be patient, not silent."
  - "Strong-fit signals: Series-A + Berlin + B2B SaaS exposure."
- `"Refresh patterns"` button (`text-xs`, accent, link-style): on click, 300ms `animate-pulse` shimmer on each bullet, then re-render the same exact three bullets.

### F8 — VC Jobs Feed (Phase 3)

- Full-width section.
- Title (`text-2xl font-semibold mb-4`): `"FA roles you might fit"`.
- Subtitle (`text-sm text-gray-500 mb-6`): `"15 curated DACH openings, ranked by fit to your profile."`
- Grid: 3 cols desktop, 2 tablet, 1 mobile, `gap-4`.
- Each card (`bg-white border rounded-12px p-5 shadow-sm hover:shadow-md`):
  - Top-right corner: fit-score badge (colored per Section 2 thresholds, `font-bold`).
  - Company name (`font-semibold text-base`).
  - Role (`text-sm`).
  - Location (`text-xs text-gray-500`).
  - "Why this matches" line (`text-sm mt-3 italic`).
  - "Add to tracker" button (`text-xs`, accent border, `rounded-lg`).

**Hardcoded fit scores (load `vc_jobs.json`, apply by company name):**

```
Cherry Ventures: 8.7 | Earlybird Venture Capital: 8.4 | Project A Ventures: 8.1
Picus Capital: 7.9 | Speedinvest: 7.7 | HV Capital: 7.5
Lakestar: 7.3 | Atomico: 7.1 | General Catalyst: 6.9
Plural: 6.7 | 9Yards Capital: 6.5 | 468 Capital: 6.3
Sastrify: 6.1 | Trade Republic: 5.9 | Helsing: 5.7
```

**Why-this-matches (deterministic by fit_score rank, NOT hardcoded company name):**

- Top-3 by fit (descending sort): `"Matches your B2B + Series-A focus — direct overlap with target."`
- All others: `"DACH-based VC with FA-track openings — review JD."`

**Top-3 glow:** compute the top-3 cards by `fit_score` (descending) at render time. Apply `ring-2 ring-purple-500 ring-opacity-50` plus `animate-pulse` (slow, 2s). Do NOT hardcode company names — derive from data.

**"Add to tracker":** append to Section 2 with `status=applied`, `fit=card.fit`, `next_action="Prep B2B-deal example"` (matches Add-Application default).

### F9 — Career-Buddy Vision Strip (Phase 1)

- Full-width strip, `bg-gray-50 py-6 text-center`.
- Heading (`text-sm uppercase tracking-wider text-gray-500`): `"Roadmap — for startup operators, not just VC-track"`.
- Body (`text-base text-gray-700 mt-2`):
  > "Today: tracker + insights + role-feed. Next: skill recommender (courses, events, Maven cohorts). Year-1: persistent Career-Buddy with multi-year memory — switch-timing, salary-negotiation, headhunter broker."

### F10 — Header (Phase 1)

- Sticky top bar.
- Left: text logo `"Career-Buddy"` (`font-semibold text-lg`, accent `#7c3aed`).
- Right: status pill `"Mock AI mode · cached demo responses"` (`text-xs bg-gray-100 rounded-full px-3 py-1`).
- Far right: small `"Reset demo"` link (`text-xs text-gray-400 underline`). On click: clear `localStorage`, reload, AND restart the full onboarding flow.

## Acceptance criteria (build verification)

**Phase 1 (must work):**

1. App loads with 8 pre-seeded applications visible immediately.
2. Onboarding chat input accepts text; "Build profile" renders the canned reply + expanded profile card.
3. CV textarea accepts paste/text; "Analyze CV" button click appends the canned analysis block.
4. "+ Add Application" modal works and appends a row.
5. "Sync Inbox" runs the animation (stagger preferred, simultaneous-flash acceptable as fallback) and ends with the summary strip showing exactly: `"8 emails scanned · 6 applications updated · 6 next actions created · 1 offer received"`.
6. After Sync: Pedlar=rejected, Avi=interview-2, Picus Capital=interview-2, Cherry Ventures=rejected, Project A=follow-up-needed, Speedinvest=offer; Earlybird and Rust unchanged status (only last_event_date updated).
7. Profile card collapses to its one-line form after Sync; "edit profile" re-expands.
8. "Reset demo" link clears state, reloads, and restarts onboarding from scratch.

**Phase 2 (should work):**

9. Insights panel shows all 3 hardcoded bullets, refresh button shimmers and re-renders.

**Phase 3 (nice-to-have):**

10. VC Jobs Feed shows 15 cards from `vc_jobs.json` with hardcoded fit scores; top-3 by fit (Cherry, Earlybird, Project A) glow — derived from data, not hardcoded names.
11. "Add to tracker" on a job card appends a row to Section 2.

**Always:**

12. Career-Buddy Vision Strip visible at the bottom.
13. NO references in UI or code to OpenAI, Anthropic, GPT, Claude, or any external AI provider — except the visible mock pill.
14. Mobile-responsive layout under `768px`.

## Build order (literal)

1. Header + visual scaffold (Section 0 + page grid).
2. Onboarding chat + Profile card (Section 1, expanded form only).
3. Applications table with 8 pre-seeded rows (Section 2 read-only).
4. CV textarea + Analyze CV (Section 1 append).
5. + Add Application modal.
6. Sync Inbox animation (stagger preferred, simultaneous fallback).
7. Summary strip + profile collapse.
8. Vision strip (Section 5).
9. **Phase 1 acceptance check.**
10. Insights panel (Section 3).
11. **Phase 2 acceptance check.**
12. VC Jobs Feed (Section 4).
13. **Phase 3 acceptance check.**

## Out of scope (do not implement)

- Real OpenAI / Anthropic / GPT / Claude / LLM integration.
- Any API key connector.
- Real email sync (Gmail, IMAP, etc.).
- Real PDF parsing.
- Real URL fetching or HTML scraping.
- Supabase Auth / Storage / runtime writes.
- Payment, teams, settings, notifications panels.
