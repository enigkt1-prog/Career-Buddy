# Claude session coordination — Career-Buddy

> Two Claude Code sessions are working on this repo in parallel today.
> This file is the source of truth for who-owns-what so we don't drift.
> **Re-read at the start of every coordination round.**

## Active sessions (2026-05-10 evening — round 7+)

| Session | Owner area | Status |
|---|---|---|
| **A — UI session** | `src/routes/*` (visual), `src/components/cinema/*`, `src/components/profile/*` (component code, not tests), `public/sw.js`, `docs/design/*`, photography | Phase 0 + 0.5 + Phase 4 (all 4 themes live with cross-device persistence via `user_tracks`) + Phase 1.5 UI stub all shipped. **IDLE pending the new CV-profile-Supabase ask + Phase 3 jobs-extraction.** |
| **B — Backend + tooling session** | `backend/career_buddy_scraper/*`, `data/migrations/*`, `supabase/functions/*` (with announce), vitest + playwright config, `src/lib/*` extraction, RTL tests for UI-owned components | Phase 1 lib-extraction complete (12 modules + 244 frontend tests). Round-7 shipped: rich-state types + state helpers + RTL coverage for ThemePicker + EmailAccounts. **Next: CV-profile-Supabase schema + lib half (see "New ask" below).** |
| **C — Classify + Layer-3 backfill session** (round 9, 2026-05-10 night) | `backend/career_buddy_scraper/cli/classify_subcat*.py`, `backend/career_buddy_scraper/cli/layer3_backfill*.py`, `backend/audit/classify_subcat-*.csv`, `backend/audit/layer3_backfill_*.csv` | Started. Tasks: (1) re-classify 8,999 `other`-bucket jobs into 10 new sub-cats + `other-misc` via Claude shim :5051 + Haiku-4.5; (2) Layer-3 backfill `level` (4933 NULL) → `years_min` (3218) → `city` (4302) → `visa_sponsorship` (9262) → `salary_min` (8366). Read-mostly LLM batch lane; no `src/**`, no migrations, no edge functions touched. |
| **D — Scraper coverage expansion** (session 4, 2026-05-10 night) | `backend/career_buddy_scraper/ats/*` (new ATS adapters), `backend/career_buddy_scraper/sources/*` (VC + accelerator seed), `backend/career_buddy_scraper/cli/scrape.py` wiring, `backend/tests/fixtures/*` + new adapter tests, `data/migrations/0013_*.sql` IF needed for accelerator entity | Started. Roadmap: Gap 1 broken-VC-adapter audit (105/209 zero-job VCs) → Gap 2 DACH + corp VC seed expansion → Gap 3 YC + accelerator pipelines → Gap 4 Workday/SmartRecruiters/JOIN/BambooHR adapters → Gap 5 aggregators (Wellfound/WWR/RemoteOK/WTTJ). NOT touching `src/**`, `supabase/*`, `cli/classify*`, `cli/layer3_backfill*`. |

## Boundary — who touches what

| Area | A | B | Notes |
|---|---|---|---|
| `src/components/CareerBuddy.tsx` | edits OK while extraction not started | will lift logic into `src/lib/*` after A signals stable | A must pause edits when B starts extraction commit-by-commit |
| `src/lib/*` | read-only (imports OK) | OWNS | B creates these, A imports |
| `src/components/profile/*.tsx` (component) | OWNS | read-only | UI ships UI components |
| `src/components/profile/*.test.tsx` (tests) | read-only | OWNS | B writes RTL coverage; A imports new components, B follows up with tests |
| `src/components/{applications,roles,insights}/*` | NEW components OK | tests-only | future ownership when extraction arrives — not started yet |
| `src/routes/*` | OWNS | read-only | B doesn't ship route files |
| `src/components/cinema/*` | OWNS | read-only | design system primitives |
| `public/sw.js` | OWNS | read-only | service worker version-bump on cache-busting deploys |
| `backend/`, `data/migrations/` | read-only | OWNS | scraper + classifier + Supabase schema |
| `supabase/functions/*` | edits with announce | edits with announce | both can touch — coordinate via this file before |
| `supabase/migrations/*` (mirror dir) | read-only | OWNS | B mirrors data/migrations files |
| `src/integrations/supabase/types.ts` | read-only | OWNS | B regenerates after schema changes |
| `vitest.config.ts`, `playwright.config.ts`, `src/test/*`, `tests/*` | read-only | OWNS | B owns the test rig |
| `docs/design/*` | OWNS | read-only | cinema design system spec |
| `docs/HANDOFF_*.md` | A writes A's handoff | B writes B's handoff | each session owns its hand-off file |
| `WORKPLAN-*.md` (gitignored) | OWNS A's plan | OWNS B's plan | one file per session, prefixed by topic |
| `MEMORY.md` + `~/.claude/projects/.../memory/*` | OWNS A's entries | OWNS B's entries | append-only across sessions |

## Commit hygiene

- Subject line MUST accurately describe the diff. Bundling unrelated
  WIP under a misleading subject makes history hard to read. If you
  find your `git add` swept up another session's files, split the
  commit before pushing.
- `git pull --rebase origin main` before any push to surface conflicts.
- Push commit-by-commit when working on multi-step extraction so the
  other session can pull mid-flight.

## NEW ASK (round 7+) — CV-profile Supabase persistence

**User ask:** real Supabase persistence for CV-analyzed profile +
first-class skills extraction.

**Decision (2026-05-10 evening):** path **(a) split per boundary**.
B ships schema + edge function + lib changes; A wires the consumer
components after B's commits land.

### B's tasks for the new ask (in this order)

1. `data/migrations/0012_user_profile.sql` — schema:
   - `id uuid PK`, `user_id uuid NULL` (nullable until multi-tenant
     auth lands, mandatory after — same convention as 0010 / 0011),
   - `name text`, `headline text`, `summary text`,
   - `skills jsonb` (array of `{ name: string, level?: string,
     years?: number, evidence?: string }` objects — first-class,
     queryable via JSONB containment ops),
   - `work_history jsonb` (mirror of monolith's `Position[]` shape),
   - `education jsonb` (mirror of `Education[]`),
   - `target_role text`, `target_geo text`, `target_role_categories
     text[]`, `location_preferences text[]`,
   - `cv_filename text`, `cv_summary text`, `cv_fit_score numeric`,
   - `created_at` + `updated_at timestamptz`,
   - UNIQUE INDEX on `COALESCE(user_id::text, '')` (one row per user
     in single-user phase),
   - GIN index on `skills` for future skill-search queries.
2. Mirror to `supabase/migrations/<ts>_user_profile.sql`, apply via
   `cd backend && uv run python -m career_buddy_scraper.cli.migrate`.
3. `supabase/functions/analyze-cv/index.ts` — extend the Gemini
   prompt to extract a `skills` array first-class (each with name +
   level + years if inferable). Add `skills` to the structured
   response schema. Update return shape.
4. Regen `src/integrations/supabase/types.ts` via the Supabase CLI
   (`npx supabase gen types typescript --linked > ...` or wrangler
   equivalent — pick whichever was used last; commit message says).
5. Extend `src/lib/cv-storage.ts` `CvAnalysisResponse` type +
   `mergeAnalysisIntoState` to consume the new `skills` field +
   merge-rule (analysis non-empty wins, else prior). Add tests.
6. Extend `src/lib/profile-store.ts` with Supabase dual-write:
   - On every `setSelectedTracks` / `setYearsBucket` / new
     `setProfileFromAnalysis(analysis, filename)` call, also upsert
     into `user_profile` table (best-effort, swallow network errors
     so localStorage stays canonical for offline).
   - On store init, fetch from `user_profile` if available + merge
     into local state.
   - Add tests with mocked Supabase client.

### A's tasks for the new ask (after B's commits land)

7. `src/components/profile/CvUploadInline.tsx` — call the new
   `setProfileFromAnalysis` helper from `lib/profile-store.ts`
   instead of (or in addition to) `mergeAnalysisIntoState` +
   `saveCareerBuddyState`. Keeps localStorage write canonical AND
   fires the Supabase upsert. RTL test (B writes follow-up).
8. `src/routes/profile.tsx` Section 03 Skills — replace the
   "Coming with Phase 1" placeholder card with a live skills-list
   driven by `useCareerBuddyState().profile.skills` (or whatever
   the loader returns post-Supabase-fetch). Each skill chip with
   name + level. Empty state if no skills yet.
9. UI smoke test of the full loop: upload CV → analyse → skills
   appear in Section 03 → reload page → skills still there from
   localStorage → check Supabase row in dashboard.

### Sequencing

A must NOT touch `data/migrations/`, `supabase/functions/analyze-cv`,
`src/lib/profile-store.ts`, `src/lib/cv-storage.ts`, or
`src/integrations/supabase/types.ts` for this ask. B must NOT touch
`src/components/profile/CvUploadInline.tsx` (the component itself —
RTL tests are fine) or `src/routes/profile.tsx`.

If B's commits 1–6 are pushed and A has nothing else ready, A
proceeds with 7–9 immediately on top.

## Open items right now (other than the new ask)

### Owned by A (UI session)

- [x] Phase 0 + 0.5 + Phase 4 (all 4 themes shipped, cross-device
      persistence via 0011 user_tracks)
- [x] Phase 1.5 UI stub (EmailAccounts component)
- [x] CV-profile new ask tasks 7–9 (round 9 — `8a437e9`,
      `CvUploadInline` now persists via `setProfileFromAnalysis`,
      `/profile` Section 03 renders live skills chips,
      `initProfileFromSupabase` runs on mount, smoke verified)
- [ ] Phase 3 deep — `/jobs` standalone (rebuild as `<RoleGrid />` +
      `<FilterBar />` importing `lib/*` directly, no
      `<CareerBuddy rolesOnly />` mount). Unblocked since B shipped
      rich-state types lift in `6982329`.
- [ ] 8 monolith child components extraction (JobCard / FilterBar /
      DraftModal / ApplicationsTracker / ApplicationRow / AddAppModal /
      ProfileCard / EditProfileModal / InsightsPanel) — UI session
      decides when to start; B follows with RTL tests per pattern.
- [x] Voice input (Web Speech API) — Phase 1 (round 10/11 —
      `2adfd52` bundled the diff under a misleading
      "round-10 complete" coord subject; voice work is shipped:
      new `src/components/voice/VoiceMic.tsx`, wired into
      `src/routes/buddy.tsx` chat input + `CvUploadInline.tsx`
      paste textarea, `voice-mic-pulse` reduced-motion-safe
      animation in `cinema.css`, graceful fallback when
      `window.SpeechRecognition` is missing)
- [ ] Floating Buddy widget (bottom-right bubble + side panel) —
      Phase 2
- [ ] Skills probe + voice everywhere — Phase 6
- [ ] Photo licensing audit (Unsplash Free → Unsplash+ or AI-generated
      production set)

### Owned by B (backend + tooling session)

- [x] Phase 1 lib extraction: 12 modules — tracks, cv-storage,
      job-fit, job-filters, profile-store, format, jobs-helpers,
      filter-presets, match-cache, types, state (cinema-theme is A's)
- [x] Migration 0010 user_email_accounts (live)
- [x] Migration 0011 user_tracks (live)
- [x] RTL coverage for CvUploadInline, ThemePicker, EmailAccounts
- [x] **CV-profile new ask tasks 1–6** (round 8 — schema 0012 live,
      analyze-cv extended, types augmented, lib + dual-write +
      mocked-Supabase tests shipped — A unblocked for 7-9)
- [x] Pre-existing CareerBuddy.tsx Supabase upsert TS error fix
      — round 8, commit `feda357` narrowed `applicationToRow` return
      to `Database["public"]["Tables"]["applications"]["Insert"]`.
      `bunx tsc --noEmit` now fully clean.
- [ ] `tests/e2e/lazy-chunks.spec.ts` — Playwright bundle
      byte-budget assertion vs `docs/iter-3-bundle-baseline.txt`
      (Iter-3 Phase 4 prep; gates monolith deletion). **Deferred** —
      avoiding new playwright/webServer wiring while round-8 cross-
      session activity is settling.
- [x] `scripts/smoke-routes.sh` — round 8, commit `a8cd7f5`. 5 routes
      return 200 against the live Worker.
- [ ] Phase 1.6 backend OAuth for `user_email_accounts` (Gmail /
      Outlook handshake + KMS / pgcrypto wrap of
      `oauth_refresh_token`). Open question: Gmail-only first or
      Gmail + Outlook day-1?
- [ ] Migration 0013_user_context_notes (only when A starts Phase 5
      auto-context summarise — defer until ping)
- [ ] Visa / level Gemini batch enrichment (defer until Free Tier
      quota refreshes)

## Open questions for the user (don't act until answered)

- Phase 1.6 OAuth: Gmail-only first (covers 80%) or Gmail + Outlook
  day-1?
- Photo gallery: licensed Unsplash+ tier, AI-generated, or curated
  public-domain?

## Known soft-skip items (intentional, not blockers)

- `/jobs` mounts `<CareerBuddy rolesOnly />` — placeholder until A
  rebuilds as standalone `<RoleGrid />` + `<FilterBar />`.
- Pre-existing `tsc --strict` failure at `CareerBuddy.tsx:501` (line
  shifts as extractions land — same Supabase `applications.upsert`
  type mismatch). Pre-dates both sessions. Vite build green; only
  `bunx tsc --noEmit` flags it. B may fix this round.

## Resolved soft-skips (no longer applicable)

- ~~Profile `years` + `tracks` write to their own localStorage keys
  only~~ → resolved by B in `c0a2214`
  (`lib/profile-store.ts` dual-writes legacy keys + state.profile).
- ~~Hardcoded `TRACKS` in `src/routes/profile.tsx`~~ → resolved by B
  in `4bf0c23` (now in `src/lib/tracks.ts`).
- ~~Rich-state types tied to monolith~~ → resolved by B in
  `6982329` (now in `src/lib/types.ts` + `src/lib/state.ts`).

## Last sync

- 2026-05-10 night (round 11 — A) — Phase 1 voice input shipped.
  New `src/components/voice/VoiceMic.tsx` wraps the Web Speech API
  (`window.SpeechRecognition` / `webkitSpeechRecognition`) with
  idle / listening / unsupported render states; the disabled
  fallback renders a `MicOff` icon with a tooltip explaining
  browser support (Chrome / Edge / Safari 14.1+ only). Mounted on
  `src/routes/buddy.tsx` next to Send (appends transcript to the
  composer input) and on `src/components/profile/CvUploadInline.tsx`
  inside the paste textarea (top-right). Reduced-motion-safe
  `voice-mic-pulse` keyframes added to `src/styles/cinema.css`. No
  external deps, no API cost. Section 03 "Speak instead (Phase 1)"
  placeholder kept untouched on purpose — that wires up in Phase 6
  (skill probe). **Subject-line flag (third occurrence):** the
  voice diff landed inside commit `2adfd52` titled "docs(coord):
  round-10 complete — lazy-chunks shipped" rather than a dedicated
  `feat(voice): ...` commit, because the round-10-wrap commit
  swept up A's staged voice changes at git-add time. Content is
  correct; only the subject misleads. **Pattern alert:** this is
  now the third bundle (a8cd7f5 swept coral photo fix into the
  smoke-routes commit; 1ed7033 swept B's RTL tests into the
  session-D coord-register commit; 2adfd52 swept A's voice
  components into the round-10-complete coord commit). Recommend
  every session run `git status -s | grep -v '^??'` before `git
  add` and pass explicit file paths instead of `git add .` or
  `git add -A`. No revert needed for any of the three.

- 2026-05-10 night (round 10 — B partial) — B shipped RTL test
  coverage for the round-9 components: `src/routes/profile.test.tsx`
  (11 new tests covering Section 03 empty/populated/level/years/
  count + init + onAnalysed refresh) and a full rewrite of
  `src/components/profile/CvUploadInline.test.tsx` (9 tests now
  mocking `@/lib/profile-store` directly to assert
  `setProfileFromAnalysis` is called with the right shape +
  `onAnalysed` callback fires on success / skips on persist error).
  Frontend tests now **273 passing** (260 → 273). tsc clean.
  **Subject-line flag:** these two test files actually landed inside
  commit `1ed7033` (titled "docs(coord): register session D —
  scraper coverage expansion") rather than a dedicated `test(...)`
  commit, because session D's coord-register commit swept up B's
  staged tests at git-add time. Content is correct; the misleading
  subject is the only artefact. Same class of bundle as `a8cd7f5`
  (round-8 cinema-theme sweep). No revert needed.

  Lazy-chunks Playwright spec shipped in `42c2aee` — 4 new e2e cases
  (3 route-loads-its-chunk + 1 anti-leak on `/`) running against the
  live Cloudflare Worker by default; override via
  `PLAYWRIGHT_BASE_URL`. Total Playwright suite now 5 passing.
  Round-10 task B done. **Local vite preview pipeline broken**
  (TanStack Start + cloudflare-vite-plugin emit
  `dist/server/assets/server-*.js` with a hash but the preview
  server-plugin imports the unhashed path) — surfaced while wiring
  webServer; tracked as a follow-up, lazy-chunks routes around it
  via the live URL.

- 2026-05-10 late evening (round 9) — A wired the UI half of the
  CV-profile-Supabase ask (tasks 7–9). Commits pushed:
  - `8a437e9` feat(profile): wire Section 03 Skills + Supabase
    persistence via `setProfileFromAnalysis`
  `CvUploadInline.tsx` now `await setProfileFromAnalysis(analysis,
  filename)` instead of direct `mergeAnalysisIntoState +
  saveCareerBuddyState`. `src/routes/profile.tsx` Section 03 replaced
  the Phase-1 placeholder card with a live skills list driven by
  `useState<SkillEntry[]>`; empty state shows a Skills board CTA back
  to `#cv-upload`; populated state shows chips with name + level +
  years. `initProfileFromSupabase()` runs on profile mount so a CV
  uploaded on another device repopulates the page without re-upload.
  `bunx tsc --noEmit` clean; vitest 260 passing; `bun run build:dev`
  green; live deploy returned HTTP/2 200 after push. **Coral hero
  photo fix from `a8cd7f5` (B's smoke commit) confirmed rendering
  live on `/profile?theme=coral` + `/?theme=coral`.** A now idle
  pending Phase 3 jobs-extraction, Phase 1 voice input, Phase 2
  floating Buddy, or another user ask.

- 2026-05-10 late evening (round 8 wrap) — B also shipped lower-
  priority tasks 7 + 9 (TS fix `feda357`, smoke-routes `a8cd7f5`).
  Lazy-chunks Playwright spec deferred. **Note for A:** commit
  `a8cd7f5` accidentally bundled an unrelated `src/lib/cinema-theme.ts`
  edit (coral overview/profile URL fix) that was already staged in
  the working tree when B committed scripts/smoke-routes.sh. The
  cinema-theme change looks intentional + correct (replaces a 404'd
  Unsplash URL) but the subject line on `a8cd7f5` doesn't reference
  it. Flagged for transparency; no revert.

- 2026-05-10 late evening (round 8) — B shipped tasks 1–6 of the
  CV-profile-Supabase ask. **A unblocked for tasks 7–9.** Commits:
  - `b6e6016` feat(db): 0012 user_profile (schema + GIN index + applied)
  - `6254655` feat(analyze-cv): first-class skills extraction + sanitizer
  - `6b1a2b3` feat(types): manual user_profile augmentation
  - `053a511` feat(lib): SkillEntry on Profile + analysis merge (+5 tests)
  - `4e68f09` feat(profile-store): Supabase dual-write helpers (+11 tests)
  Frontend tests now 260 (244 → 260). Backend 258 unchanged. Build +
  tsc green except the long-tracked CareerBuddy.tsx:501 upsert error.

  **Public surface for A's wire:** import from `@/lib/profile-store`:
  - `setProfileFromAnalysis(analysis, filename): Promise<void>`
  - `initProfileFromSupabase(): Promise<void>`
  - `fetchPersistedProfile()` (read-only helper)
  Replace `mergeAnalysisIntoState` + `saveCareerBuddyState` calls in
  `CvUploadInline.tsx` with `await setProfileFromAnalysis(analysis,
  filename)`. Call `initProfileFromSupabase()` on the profile route's
  mount (or app root) once.

- 2026-05-10 evening (round 7) — B finished rich-state types lift +
  RTL tests for ThemePicker + EmailAccounts. A finished Phase 4 step
  3 + Phase 1.5 UI stub. **Decision:** path (a) for the new
  CV-profile-Supabase ask — B ships 1–6, A wires 7–9 after. Two
  fresh hand-off prompts written for new chats per session.
