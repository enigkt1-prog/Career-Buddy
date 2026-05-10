# Claude session coordination — Career-Buddy

> Two Claude Code sessions are working on this repo in parallel today.
> This file is the source of truth for who-owns-what so we don't drift.
> **Re-read at the start of every coordination round.**

## Active sessions (2026-05-10 evening)

| Session | Owner area | Status |
|---|---|---|
| **A — UI session** (this file's primary author) | `src/routes/*` (visual), `src/components/cinema/*`, `src/components/profile/*`, `public/sw.js`, design docs, photography | Phase 0.5 shipped (commit `c1f47ee`). Working on bug-fix follow-up + email-integration spec. |
| **B — Backend + tooling session** | `backend/career_buddy_scraper/*`, `data/migrations/*`, vitest + playwright config, `src/lib/*` extraction (Phase 1 of iter-3 split) | Backend classifier 100% (commit `d82770b` ancestry). Test infra shipped. Next: `lib/*` extraction with vitest tests on `tokenize`, `fitScore`, `applyFilters`. |

## Boundary — who touches what

| Area | A | B | Notes |
|---|---|---|---|
| `src/components/CareerBuddy.tsx` | edits OK while extraction not started | will lift logic into `src/lib/*` after A signals stable | A must pause edits when B starts extraction commit-by-commit |
| `src/lib/{tracks,job-fit,job-filters,cv-storage}.ts` | read-only | OWNS | B creates these, A imports |
| `src/components/{profile,applications,roles,insights}/*` | NEW components OK in `profile/` only | future ownership when extraction arrives | currently only `profile/CvUploadInline.tsx` exists |
| `src/routes/*` | OWNS | read-only | B doesn't ship route files |
| `src/components/cinema/*` | OWNS | read-only | design system primitives |
| `public/sw.js` | OWNS | read-only | service worker version-bump on cache-busting deploys |
| `backend/`, `data/migrations/` | read-only | OWNS | scraper + classifier + Supabase schema |
| `supabase/functions/*` | edits with announce | edits with announce | both can touch — coordinate via this file before |
| `vitest.config.ts`, `playwright.config.ts`, `src/test/*`, `tests/*` | read-only | OWNS | B owns the test rig |
| `docs/design/*` | OWNS | read-only | cinema design system spec |
| `WORKPLAN-*.md` (gitignored) | OWNS A's plan | OWNS B's plan | one file per session, prefixed by topic |
| `MEMORY.md` + `~/.claude/projects/.../memory/*` | OWNS A's entries | OWNS B's entries | append-only across sessions |

## Commit hygiene

- Subject line MUST accurately describe the diff. Bundling unrelated
  WIP under a misleading subject (as happened with `c1f47ee` → "vitest
  + playwright tooling" while the diff also included A's UI WIP) makes
  history hard to read. If you find your `git add` swept up another
  session's files, split the commit before pushing.
- `git pull --rebase origin main` before any push to surface conflicts.
- Push commit-by-commit when working on multi-step extraction so the
  other session can pull mid-flight.

## Open items right now

### Owned by A (UI session)
- [x] Phase 0.5 IA cleanup + Profile depth + /jobs route + cinema chrome
- [x] CV upload service-worker cache fix (sw v3 + network-first for HTML)
- [x] PromoBar /jobs link, /jobs fetch raised 500 → 10000
- [ ] Email integration spec (Gmail OAuth + multi-account, planned for
      Phase 1.5; needs Supabase `user_email_accounts` migration owned by B)
- [ ] Supabase storage photo gallery for theme-pack photography (planned
      for Phase 4 prep; needs `cinema_photos` bucket owned by B)
- [ ] Onyx theme palette prototype on `/design-preview?theme=onyx` (Phase 4)

### Owned by B (backend + tooling session)
- [ ] Phase 1 of iter-3 split: extract `tokenize`/`fitScore`/`applyFilters`
      into `src/lib/*` + vitest tests targeting 80% coverage threshold
- [ ] Move `TRACKS` array from `src/routes/profile.tsx` to
      `src/lib/tracks.ts` so `/jobs` filter UI can reuse it (filter UI
      ownership stays with A, but the data shape stays in B's lib)
- [ ] Migration `0010_user_email_accounts.sql` (Phase 1.5 dep)
- [ ] Migration `0011_jobs_search_index.sql` with
      `CREATE INDEX CONCURRENTLY` (Phase 3 dep — when A does
      server-side jobs pagination)

### Open questions for the user (don't act until answered)
- Onyx theme: ship as second after Sage, or different priority?
- Email integration: Gmail-only first (covers 80%) or Gmail + Outlook day-1?
- Photo gallery: licensed Unsplash+ tier, AI-generated, or curated public-domain?

## Known soft-skip items (intentional, not blockers)

- Profile `years` + `tracks` write to their own localStorage keys
  (`career-buddy-tracks-v1`, `career-buddy-years-bucket-v1`), NOT into
  `career-buddy-state.profile`. The Profile UI says "Saved locally for
  now — Phase 1 syncs to your account." B's lib extraction will add a
  `lib/profile-store.ts` that B can wire into `career-buddy-state` as
  part of the lift.
- `/jobs` mounts `<CareerBuddy rolesOnly />` — placeholder until B's
  Phase 2 extraction ships `<RoleGrid />` standalone.
- Pre-existing `tsc --strict` failure at `CareerBuddy.tsx:1170`
  (Supabase `applications.upsert` type mismatch) — pre-dates both
  sessions, neither owns the fix today.
- Hardcoded `TRACKS` in `src/routes/profile.tsx` — B will move to
  `src/lib/tracks.ts` in Phase 1 of the extraction.

## Last sync

- 2026-05-10 evening — A pushed Phase 0.5 (`c1f47ee`), B asked for
  state. A acknowledges B's findings, delegates Phase 1 extraction to
  B, ships PromoBar link + /jobs fetch bump + sw cache-fix on top.
