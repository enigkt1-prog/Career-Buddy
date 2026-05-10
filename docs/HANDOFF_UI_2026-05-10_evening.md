# Handoff — Career-Buddy UI session (2026-05-10 evening)

> Re-read end-to-end before doing anything. Previous chat reached
> ~60% context — handed off here so the next chat picks up clean.

## TL;DR

- Live: `https://career-buddy.enigkt1.workers.dev`
- Repo root: `/Users/troelsenigk/fa-track`. Branch `main`. All commits pushed.
- HEAD: `5e9f5e7 feat(theme): wire ThemePicker + RootShell to Supabase user_tracks (0011)`
- Two Claude Code sessions in parallel today. **`CLAUDE_COORDINATION.md` is the canonical boundary doc — read it.**
- Phase 0 + 0.5 + 4 (all 3 steps) shipped. Phase 1.5 UI stub shipped.
- **Open user ask:** real Supabase persistence for CV-analyzed profile + first-class skills extraction. Needs migration `0012_user_profile.sql` + `analyze-cv` edge-function skills section + `lib/profile-store.ts` dual-write. See "Next user-facing tasks" below.

## Two-session split (active)

Per `CLAUDE_COORDINATION.md`:

| Owner | Area |
|---|---|
| **A — UI session** (this handoff) | `src/routes/*`, `src/components/cinema/*`, `src/components/profile/*`, `public/sw.js`, `docs/design/*` |
| **B — Backend + tooling** | `backend/*`, `data/migrations/*`, `supabase/functions/*` (with announce), `vitest.config.ts`, `playwright.config.ts`, `src/test/*`, `tests/*`, `src/lib/*` extraction |

**Latest B activity** (per their last check-in):
- Round 1–6 complete: 12 lib modules, 206 vitest tests, migrations 0010 + 0011, RTL coverage for `CvUploadInline`.
- B greenlit two next steps from A: (1) lift rich-state types to `src/lib/types.ts`, (2) RTL tests for `ThemePicker` + `EmailAccounts`.
- B pending — neither blocked: `lib/types.ts` lift, RTL tests for new components, optional Phase 1.6 backend OAuth.

## What ships on origin/main right now

```
5e9f5e7  feat(theme): wire ThemePicker + RootShell to Supabase user_tracks (0011)
4c07e3e  feat(profile): Phase 4 step 3 + Phase 1.5 — ThemePicker + EmailAccounts
92c75c8  refactor(lib): extract match-cache + quota storage             (B)
13af330  refactor(lib): extract filter-presets storage                  (B)
03994a5  test(profile): RTL coverage for CvUploadInline                 (B)
33d083f  refactor(lib): extract misc job/profile helpers (jobs-helpers) (B)
639365d  refactor(lib): extract formatting helpers (format)             (B)
797d227  fix(hero): stronger gradient + text-shadow for legibility on light themes
0f8a87e  docs(coord): round-4 sync                                      (coord)
e5c8d88  feat(db): 0010 user_email_accounts                             (B)
404f942  feat(db): 0011 user_tracks                                     (B)
c0a2214  feat(lib): profile-store bridge — sync /profile track+years    (B)
ea184ca  refactor(lib): extract job-feed filters + sort                 (B)
0acc46a  refactor(lib): extract job-fit scoring + token utilities       (B)
bbbcb8c  feat(theme): Phase 4 step 2 — Slate + Coral palettes + per-theme photography
fafc7b4  feat(theme): Phase 4 step 1 — theme-swap architecture + Onyx
6431b40  feat: Phase 0.5 — IA + CV-upload fixes + /jobs route + cinema chrome
8949576  feat(ia): Phase 0 cleanup — drop redundant nav, rename Chat→Buddy, fold CV into Profile
b2085d5  feat(design): Cinema (Sage) design system across all routes
```

## What's working (live + verified)

- **4 cinema themes** swappable via `?theme=sage|onyx|slate|coral` URL param OR Profile section "06 — Theme" picker. Persists to localStorage AND Supabase `user_tracks` (cross-device).
- **Per-theme photography** — every (theme, surface) pair points at a verified-rendering Unsplash URL via `src/lib/cinema-theme.ts` `usePhoto(surface)` hook.
- **Profile route** — 6 sections: 01 Years · 02 Tracks · 03 Skills (intro placeholder) · 04 CV upload (inline) · 05 Email (Phase 1.5 stub) · 06 Theme (live picker).
- **Overview** (`/`) — top-6 roles + "See full feed →" link to `/jobs`.
- **Jobs** (`/jobs`) — full filterable feed (10,000-row cap via `.range(0, 9999)` to bypass PostgREST default).
- **Buddy** (`/buddy`) — chat with cinema chrome (formerly `/chat`).
- **PromoBar** — links to `/jobs` ("9,980 live operator-track roles · See all").
- **CV upload bug fixed**: button + ref + `.click()` pattern (Safari-safe), service-worker `v3` network-first for HTML so users don't get cached old builds.

## What's working (offline / partial)

- **CV upload → analysis pipeline**:
  - File pick + extract works (`src/lib/cv-parser.ts`)
  - `supabase.functions.invoke("analyze-cv")` returns `{ analysis }` with `summary`, `name`, `headline`, `strengths[]`, `gaps[]`, `recommendations[]`, `target_role_categories[]`, `location_preferences[]`, `work_history[]`, `education[]`
  - Result merged into `localStorage["career-buddy-state"].profile` via `lib/cv-storage.ts` `mergeAnalysisIntoState()` — read by Overview's `<CareerBuddy />` so Profile shows up there.
  - **NOT persisted to Supabase**. Skills NOT a first-class field (lumped in `strengths` + `target_role_categories`).

## Open user-facing tasks (the "ja mach das alles selber" ask)

User asked: does CV → analysis → structure → skills → Supabase save work? Answer: 4/5 yes, 1/5 no (Supabase save). To finish the loop:

| Task | Owner per coord doc | Crosses boundary? |
|---|---|---|
| `data/migrations/0012_user_profile.sql` (skills JSONB, work_history JSONB, etc.) | B | yes if A does it |
| Mirror `supabase/migrations/<ts>_user_profile.sql` + apply to Supabase | B | yes |
| `supabase/functions/analyze-cv/index.ts` — add `skills` first-class section to prompt + return shape | A or B with announce | shared territory |
| Regenerate `src/integrations/supabase/types.ts` after 0010+0011+0012 | B | yes |
| `src/lib/profile-store.ts` dual-write to Supabase `user_profile` | B | yes (lib/* is B's) |
| `src/lib/cv-storage.ts` `mergeAnalysisIntoState` consume new `skills` field | B (lib/*) | yes |
| `src/components/profile/CvUploadInline.tsx` — call new dual-write helper | A | A's territory |
| `src/routes/profile.tsx` Section 03 Skills — replace placeholder with live skills list | A | A's territory |

**Two paths forward:**

1. **(a) Stay split** — ping B with greenlight to ship the migration + lib changes; A does CvUploadInline wire + Skills section UI after. Lower risk of merge collision.
2. **(b) UI session does it all** — write migration in `data/migrations/0012_user_profile.sql`, mirror to `supabase/migrations/<ts>_user_profile.sql`, update analyze-cv edge function, regen types via `npx supabase gen types typescript --linked`, write profile-store dual-write, wire UI. Faster but crosses the convention boundary.

**User preference signal:** "kannst du das alles nicht selber machen?" — leans toward (b). If new chat goes (b), update CLAUDE_COORDINATION.md FIRST so B sees the boundary change before they pull.

## Next visual / UX TODOs

- Phase 1.6 backend OAuth (Gmail / Outlook). UI is stubbed in `EmailAccounts.tsx`; backend handshake + KMS/pgcrypto layer is B's territory.
- Photo licensing audit — Unsplash Free works for prototype; production may need Unsplash+ tier or AI-generated set. User flagged copyright concern earlier.
- Phase 3 deep — `/jobs` currently mounts `<CareerBuddy rolesOnly />`. Once B finishes rich-types lift, A can rebuild `/jobs` as standalone `<RoleGrid />` + `<FilterBar />` importing `lib/job-fit` + `lib/job-filters` + `lib/match-cache` + `lib/format` directly. Removes the placeholder coupling.
- Server-side jobs pagination once user counts grow past the 10k client-side bundle. Needs migration `0013_jobs_search_index.sql` (deferred, was 0011 in the original workplan but 0011 went to user_tracks).

## Pre-existing TS strict failure

- `src/components/CareerBuddy.tsx:697` (line moved through extractions; was 1170 → 839 → 697). Supabase `applications.upsert` type mismatch. Pre-dates both sessions, both treat as out-of-scope. Vite build green, only `npx tsc --strict --noEmit` flags it. If it bothers you, fix in a dedicated commit — typed Supabase row payload, not `Record<string, unknown>`.

## Hard rules (carried forward, do not violate)

- No Anthropic API auto-pay paths.
- No Gemini paid auto-fallback (`GEMINI_FALLBACK_ENABLED=1` opt-in only).
- No `git push` without explicit user "ja".
- No drop-shadow on cinema glass cards (depth = blur+tint).
- ≥ 16px chrome text, 44×44 px pill targets, no emoji in chrome.
- No `purple-*` / `#7c3aed` in `src/`.
- `prefers-reduced-motion: reduce` covers reveal + pill CTAs.
- shadcn semantic tokens (`--background` / `--foreground` / `--primary`) untouched.

## Files the next chat should re-read first

1. `/Users/troelsenigk/fa-track/CLAUDE_COORDINATION.md` — boundary doc.
2. `/Users/troelsenigk/fa-track/WORKPLAN-cinema-personalization-2026-05-10.md` — full phase plan (gitignored, local only).
3. `/Users/troelsenigk/fa-track/docs/HANDOFF_UI_2026-05-10_evening.md` — this file.
4. `/Users/troelsenigk/fa-track/docs/design/design-system.md` — cinema design rules.
5. `/Users/troelsenigk/.claude/projects/-Users-troelsenigk-fa-track/memory/MEMORY.md` — auto-loaded memory pointers.
6. `/Users/troelsenigk/fa-track/src/lib/cinema-theme.ts` — theme registry + photo library + Supabase wrappers.

## Verification block (paste in new chat after pull)

```bash
cd /Users/troelsenigk/fa-track
git pull --rebase origin main
git log --oneline -5
npm run build:dev | tail -3
curl -m 5 -sI https://career-buddy.enigkt1.workers.dev/ | head -3
```

Expected:
- HEAD ≥ `5e9f5e7`
- Vite build "✓ built in"
- HTTP/2 200 from Cloudflare

## Coordination state at handoff

A (UI session) — IDLE, waiting on user direction. Last user msg: "kannst du das alles nicht selber machen? bereite handoff doc und handoff prompt vor".

B (backend session) — last seen pending greenlight on:
1. Rich-state types lift to `src/lib/types.ts`.
2. RTL tests for `ThemePicker` + `EmailAccounts`.

Both pre-approved by A in the last reply that hasn't been sent yet (next chat should send the round-7 coordination message that was drafted at end of previous chat).
