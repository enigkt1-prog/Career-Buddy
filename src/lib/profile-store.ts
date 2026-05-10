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

import {
  loadCareerBuddyState,
  saveCareerBuddyState,
  type CareerBuddyState,
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
