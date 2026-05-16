/**
 * Profile UI state ↔ CareerBuddy state bridge.
 *
 * The Profile route (`src/routes/profile.tsx`) currently writes the
 * user's selected tracks + years bucket into their OWN localStorage
 * keys (`career-buddy-tracks-v1`, `career-buddy-years-bucket-v1`),
 * separate from `career-buddy-state.profile` that the Overview
 * monolith (`CareerBuddy.tsx`) reads. That meant tracks chosen on
 * /profile didn't influence role-fit grading on /.
 *
 * This module is the bridge. Each mutation on /profile calls
 * {@link setSelectedTracks} or {@link setYearsBucket} which:
 *  1. writes the legacy key (compat with existing readers + tests)
 *  2. mirrors the value into `career-buddy-state.profile.*`:
 *     - tracks → `target_role_categories`
 *     - years bucket → `years_min` / `years_max` derived numbers
 *
 * Reads also consider both sources; if `career-buddy-state.profile`
 * already has values (e.g. set by CV analysis), they win on first
 * load to avoid clobbering CV-derived data with an empty UI state.
 *
 * Pure-ish: state is in localStorage but the helpers are easy to
 * test by stubbing `window.localStorage` (which the vitest setup
 * already does per-test).
 */

import { supabase } from "@/integrations/supabase/client";

import { getCurrentUserId } from "./auth";
import {
  loadCareerBuddyState,
  mergeAnalysisIntoState,
  saveCareerBuddyState,
  type CareerBuddyState,
  type CvAnalysisResponse,
  type Profile,
  type SkillEntry,
} from "./cv-storage";

export const TRACKS_KEY = "career-buddy-tracks-v1";
export const YEARS_BUCKET_KEY = "career-buddy-years-bucket-v1";

export type YearsBucketId = "lt1" | "1to2" | "3to5" | "6to10" | "gt10";

/**
 * Maps the experience bucket UI choice to numeric `years_min` /
 * `years_max` so the role-fit engine has the same shape it expects
 * from CV analysis. `years_max` is optional — open-ended (>10 years).
 */
export const YEARS_BUCKET_RANGES: Record<
  YearsBucketId,
  { years_min: number; years_max?: number }
> = {
  lt1: { years_min: 0, years_max: 0 },
  "1to2": { years_min: 1, years_max: 2 },
  "3to5": { years_min: 3, years_max: 5 },
  "6to10": { years_min: 6, years_max: 10 },
  gt10: { years_min: 10 },
};

const VALID_BUCKETS = new Set<string>(Object.keys(YEARS_BUCKET_RANGES));

function safeReadString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteString(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / SecurityError */
  }
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function loadSelectedTracks(): string[] {
  // Prefer career-buddy-state.profile.target_role_categories if set;
  // fall back to the legacy tracks-v1 key.
  const state = loadCareerBuddyState();
  const fromState = state.profile?.target_role_categories;
  if (Array.isArray(fromState) && fromState.length > 0) {
    return fromState as string[];
  }
  const raw = safeReadString(TRACKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist track selection. Writes BOTH the legacy key (compat) AND
 * mirrors into `career-buddy-state.profile.target_role_categories`
 * so CareerBuddy.tsx role-fit grading sees it on next read.
 */
export function setSelectedTracks(tracks: string[]): void {
  safeWriteString(TRACKS_KEY, JSON.stringify(tracks));

  const state = loadCareerBuddyState();
  const next: CareerBuddyState = {
    ...state,
    profile: {
      ...(state.profile ?? {}),
      target_role_categories: tracks,
    },
  };
  saveCareerBuddyState(next);
}

// ---------------------------------------------------------------------------
// Years bucket
// ---------------------------------------------------------------------------

export function loadYearsBucket(): YearsBucketId | null {
  const raw = safeReadString(YEARS_BUCKET_KEY);
  if (raw && VALID_BUCKETS.has(raw)) {
    return raw as YearsBucketId;
  }
  // Fallback: derive from career-buddy-state.profile.years_min if set.
  const state = loadCareerBuddyState();
  const ymin = state.profile?.years_min;
  if (typeof ymin === "number") {
    if (ymin < 1) return "lt1";
    if (ymin < 3) return "1to2";
    if (ymin < 6) return "3to5";
    if (ymin < 10) return "6to10";
    return "gt10";
  }
  return null;
}

/**
 * Persist years bucket. Writes BOTH the legacy key AND mirrors into
 * `career-buddy-state.profile.{years_min, years_max}` so role-fit
 * grading sees the numeric range.
 */
export function setYearsBucket(bucket: YearsBucketId): void {
  safeWriteString(YEARS_BUCKET_KEY, bucket);

  const range = YEARS_BUCKET_RANGES[bucket];
  const state = loadCareerBuddyState();
  const next: CareerBuddyState = {
    ...state,
    profile: {
      ...(state.profile ?? {}),
      years_min: range.years_min,
      years_max: range.years_max ?? null,
    },
  };
  saveCareerBuddyState(next);
}

// ---------------------------------------------------------------------------
// Supabase persistence — `user_profile` (migration 0012)
//
// Single-user-app shape: one row with `user_id IS NULL`, same convention as
// 0010 / 0011. The COALESCE-based unique index keeps the upsert idempotent
// without an auth context. Generated supabase/types.ts now carries the
// row shape (see 6b1a2b3) but we still cast to `never` for the strict
// client because the `Database["public"]["Tables"]` lookup path in
// supabase-js is invariant on the literal table-name parameter.
// ---------------------------------------------------------------------------

type UserProfileRow = {
  user_id: string | null;
  name: string | null;
  headline: string | null;
  summary: string | null;
  skills: SkillEntry[];
  work_history: unknown[];
  education: unknown[];
  target_role: string | null;
  target_geo: string | null;
  target_role_categories: string[];
  location_preferences: string[];
  cv_filename: string | null;
  cv_summary: string | null;
  cv_fit_score: number | null;
  updated_at: string;
};

function profileToRow(profile: Profile, userId: string | null): UserProfileRow {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    user_id: userId,
    name: str(profile.name),
    headline: str(profile.headline),
    summary: null,
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    work_history: Array.isArray(profile.work_history) ? (profile.work_history as unknown[]) : [],
    education: Array.isArray(profile.education) ? (profile.education as unknown[]) : [],
    target_role: str(profile.target_role),
    target_geo: str(profile.target_geo),
    target_role_categories: arr(profile.target_role_categories),
    location_preferences: arr(profile.location_preferences),
    cv_filename: str(profile.cv_filename),
    cv_summary: str(profile.cv_summary) ?? (profile.cv_summary === null ? null : null),
    cv_fit_score: num(profile.cv_fit_score),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Merge the analyze-cv response into local state + best-effort upsert
 * to Supabase `user_profile`. localStorage stays canonical: if the
 * network call fails (offline, RLS, missing columns) the function
 * still returns successfully so the UI doesn't lose user data.
 *
 * Stamps `profile.updated_at` (ISO string) on the local profile so
 * the init path can compare timestamps with Supabase's `updated_at`.
 *
 * The F2 CV radar rides along: `mergeAnalysisIntoState` copies
 * `analysis.radar` (axes + insights + `snapshot_id`) onto the local
 * profile so the latest snapshot drives the Profile-route radar. The
 * snapshot row itself is appended server-side by the analyze-cv edge
 * function; `user_radar_snapshots` is not part of the `user_profile`
 * upsert below.
 *
 * Returns the merged + persisted {@link CareerBuddyState}. The
 * Overview monolith feeds this return value straight into its React
 * state so its own persist effect re-serialises exactly what this
 * helper already wrote — one writer to `STORAGE_KEY`, no clobber.
 */
export async function setProfileFromAnalysis(
  analysis: CvAnalysisResponse,
  cvFilename: string,
): Promise<CareerBuddyState> {
  const prior = loadCareerBuddyState();
  const merged = mergeAnalysisIntoState(prior, analysis, cvFilename);
  const updatedAt = new Date().toISOString();
  const next: CareerBuddyState = {
    ...merged,
    profile: {
      ...(merged.profile ?? {}),
      updated_at: updatedAt,
    },
  };
  saveCareerBuddyState(next);

  // Anonymous-mode-aware: skip Supabase upsert when no session.
  // localStorage remains the canonical store; once the user signs
  // in, migrateLocalStorageToSupabase() backfills.
  const userId = await getCurrentUserId();
  if (!userId) return next;

  try {
    const row = profileToRow(next.profile as Profile, userId);
    row.updated_at = updatedAt;
    await supabase
      .from("user_profile" as never)
      .upsert(row as never, { onConflict: "user_id", ignoreDuplicates: false });
  } catch {
    /* ignore — localStorage is the canonical store while offline */
  }
  return next;
}

/**
 * Fetch the persisted user_profile row for the current user (single-
 * user app: `user_id IS NULL`). Returns `null` if no row, the table
 * doesn't exist yet, or the network call fails.
 */
export async function fetchPersistedProfile(): Promise<UserProfileRow | null> {
  try {
    const userId = await getCurrentUserId();
    // Pre-migration / anonymous: query the legacy single-user row
    // (user_id IS NULL). Post-migration / signed-in: query the
    // current user's row (auth.uid() — RLS-scoped, so no `.is`
    // filter needed).
    const query = supabase
      .from("user_profile" as never)
      .select(
        "user_id,name,headline,summary,skills,work_history,education,target_role,target_geo,target_role_categories,location_preferences,cv_filename,cv_summary,cv_fit_score,updated_at",
      );
    const scoped = userId ? query.eq("user_id", userId) : query.is("user_id", null);
    const { data, error } = await scoped.limit(1).maybeSingle();
    if (error || !data) return null;
    return data as unknown as UserProfileRow;
  } catch {
    return null;
  }
}

/**
 * On app init, fetch the Supabase user_profile row and merge into
 * local state when Supabase is newer (per `updated_at`). Empty
 * Supabase fields never overwrite filled local fields. Local timestamp
 * is read from `profile.updated_at`; missing or invalid local
 * timestamp counts as "stale" so Supabase wins on first install.
 *
 * Best-effort: silent on any network failure.
 */
export async function initProfileFromSupabase(): Promise<void> {
  const row = await fetchPersistedProfile();
  if (!row) return;
  const state = loadCareerBuddyState();
  const local = state.profile ?? {};
  const localTs = parseTs(local.updated_at);
  const remoteTs = parseTs(row.updated_at);
  if (localTs !== null && remoteTs !== null && remoteTs <= localTs) return;

  const next: Profile = { ...local };
  applyIfPresent(next, "name", row.name);
  applyIfPresent(next, "headline", row.headline);
  applyIfArray(next, "skills", row.skills);
  applyIfArray(next, "work_history", row.work_history);
  applyIfArray(next, "education", row.education);
  applyIfPresent(next, "target_role", row.target_role);
  applyIfPresent(next, "target_geo", row.target_geo);
  applyIfArray(next, "target_role_categories", row.target_role_categories);
  applyIfArray(next, "location_preferences", row.location_preferences);
  applyIfPresent(next, "cv_filename", row.cv_filename);
  applyIfPresent(next, "cv_summary", row.cv_summary);
  if (typeof row.cv_fit_score === "number") next.cv_fit_score = row.cv_fit_score;
  next.updated_at = row.updated_at;

  saveCareerBuddyState({ ...state, profile: next });
}

// ---------------------------------------------------------------------------
// LocalStorage → Supabase migration (multi-user cutover).
//
// On first signed-in load, push any localStorage state that lives
// only client-side up to the user's Supabase rows (post-0014 RLS
// scoped). Idempotent per data-class via
// `career-buddy-migrated-${uid}-${class}` flags. Multi-tab safe
// via BroadcastChannel + a localStorage timestamp fallback for
// browsers where BroadcastChannel is undefined (Safari private
// browsing).
// ---------------------------------------------------------------------------

const MIGRATE_CHANNEL = "cb-migrate";
const MIGRATE_LOCK_TTL_MS = 30_000;
const MIGRATE_CLASSES = ["profile", "tracks"] as const;
type MigrateClass = (typeof MIGRATE_CLASSES)[number];

function flagKey(uid: string, cls: MigrateClass): string {
  return `career-buddy-migrated-${uid}-${cls}`;
}

function lockKey(uid: string): string {
  return `career-buddy-migrate-lock-${uid}`;
}

function classMigrated(uid: string, cls: MigrateClass): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(flagKey(uid, cls)) === "1";
  } catch {
    return false;
  }
}

function markClassMigrated(uid: string, cls: MigrateClass): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(flagKey(uid, cls), "1");
  } catch {
    /* quota / SecurityError — swallow */
  }
}

/**
 * Claim the migration lock for `uid`. Returns true if WE own it,
 * false if another tab does. Uses BroadcastChannel as primary
 * signal + a localStorage timestamp fallback (auto-expires after
 * MIGRATE_LOCK_TTL_MS). Idempotent upserts make this best-effort
 * by design — even if two tabs race the upserts are no-ops.
 */
function tryClaimLock(uid: string): boolean {
  if (typeof window === "undefined") return true;
  const key = lockKey(uid);
  try {
    const raw = window.localStorage.getItem(key);
    const now = Date.now();
    if (raw) {
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && now - ts < MIGRATE_LOCK_TTL_MS) {
        return false;
      }
    }
    window.localStorage.setItem(key, String(now));
  } catch {
    /* private-browsing / quota → still attempt migration */
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(MIGRATE_CHANNEL);
      ch.postMessage({ uid, started: true });
      ch.close();
    }
  } catch {
    /* fallback path is the localStorage timestamp above */
  }
  return true;
}

/**
 * On first signed-in load, migrate localStorage state to Supabase
 * rows scoped to `auth.uid()`. Per-data-class idempotency flag so
 * a failed class retries on next mount; success classes don't re-run.
 *
 * Returns the set of classes that ran this call (empty if no work
 * needed / no session / lock held by another tab).
 */
export async function migrateLocalStorageToSupabase(): Promise<MigrateClass[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  if (!tryClaimLock(userId)) return [];

  const ran: MigrateClass[] = [];
  const local = loadCareerBuddyState();
  const profile = (local.profile ?? {}) as Profile;

  // profile class — full Profile row upsert if local has any
  // populated content + remote is empty (or older).
  if (!classMigrated(userId, "profile")) {
    const hasLocalProfile =
      Boolean(profile.cv_analyzed) ||
      Boolean(profile.name) ||
      Boolean(profile.headline) ||
      (Array.isArray(profile.skills) && profile.skills.length > 0) ||
      (Array.isArray(profile.work_history) && profile.work_history.length > 0);
    if (hasLocalProfile) {
      try {
        const row = profileToRow(profile, userId);
        row.updated_at =
          typeof profile.updated_at === "string"
            ? profile.updated_at
            : new Date().toISOString();
        const { error } = await supabase
          .from("user_profile" as never)
          .upsert(row as never, { onConflict: "user_id", ignoreDuplicates: false });
        if (!error) {
          markClassMigrated(userId, "profile");
          ran.push("profile");
        }
      } catch {
        /* leave flag unset → retry next mount */
      }
    } else {
      markClassMigrated(userId, "profile");
    }
  }

  // tracks class — primary track + years bucket → user_tracks row.
  if (!classMigrated(userId, "tracks")) {
    const tracks = loadSelectedTracks();
    const yearsBucket = loadYearsBucket();
    if (tracks.length > 0 || yearsBucket !== null) {
      try {
        const trackPrimary = tracks[0];
        const trackSecondary = tracks.slice(1);
        if (trackPrimary) {
          const row = {
            user_id: userId,
            track_primary: trackPrimary,
            track_secondary: trackSecondary,
            updated_at: new Date().toISOString(),
          };
          const { error } = await supabase
            .from("user_tracks" as never)
            .upsert(row as never, { onConflict: "user_id", ignoreDuplicates: false });
          if (!error) {
            markClassMigrated(userId, "tracks");
            ran.push("tracks");
          }
        } else {
          markClassMigrated(userId, "tracks");
        }
      } catch {
        /* leave flag unset → retry next mount */
      }
    } else {
      markClassMigrated(userId, "tracks");
    }
  }

  return ran;
}

function parseTs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function applyIfPresent(target: Profile, key: keyof Profile, value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    (target as Record<string, unknown>)[key as string] = value;
  }
}

function applyIfArray(target: Profile, key: keyof Profile, value: unknown): void {
  if (Array.isArray(value) && value.length > 0) {
    (target as Record<string, unknown>)[key as string] = value;
  }
}
