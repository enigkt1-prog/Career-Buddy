/**
 * Single source of truth for the `career-buddy-state` localStorage shape.
 *
 * Both `CareerBuddy.tsx` (Overview monolith) and
 * `components/profile/CvUploadInline.tsx` (Profile route) read+write
 * to this shape. Without a shared module they drift the moment one
 * adds a field. This lib exists to prevent that drift.
 *
 * Public surface:
 *  - {@link STORAGE_KEY} — localStorage key (no `-v1` suffix; matches
 *    the live monolith).
 *  - {@link Profile} — partial structural type. Fields are optional
 *    because the UI mutates incrementally.
 *  - {@link CareerBuddyState} — wrapper containing the profile plus
 *    other top-level fields (applications, sync_completed, etc.).
 *  - {@link CvAnalysisResponse} — shape returned by `analyze-cv` edge
 *    function (Gemini structured output).
 *  - {@link loadCareerBuddyState} / {@link saveCareerBuddyState} —
 *    safe-parse + write helpers.
 *  - {@link mergeAnalysisIntoState} — merge a CV analysis into the
 *    stored state's profile, preserving any pre-existing fields the
 *    analysis didn't fill. Pure (takes + returns CareerBuddyState).
 */

export const STORAGE_KEY = "career-buddy-state";

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

/**
 * First-class skill entry. Mirror of the analyze-cv structured response
 * (see supabase/functions/analyze-cv/index.ts) and the JSONB shape
 * stored in the `user_profile.skills` Supabase column (0012 migration).
 */
export type SkillEntry = {
  name: string;
  level?: SkillLevel;
  years?: number;
  evidence?: string;
};

export type CvAnalysisResponse = {
  summary?: string | null;
  fit_score?: number | null;
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  target_role_categories?: string[];
  location_preferences?: string[];
  name?: string;
  headline?: string;
  work_history?: unknown[];
  education?: unknown[];
  skills?: SkillEntry[];
};

export type Profile = {
  built?: boolean;
  cv_analyzed?: boolean;
  cv_filename?: string;
  cv_summary?: string | null;
  cv_fit_score?: number | null;
  name?: string;
  headline?: string;
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  target_role_categories?: string[];
  location_preferences?: string[];
  skills?: SkillEntry[];
  // Forward-compatible: monolith may carry additional keys we don't
  // own here (target_role, target_geo, work_history, etc.). They pass
  // through untouched via the spread in mergeAnalysisIntoState.
  [extra: string]: unknown;
};

export type CareerBuddyState = {
  profile?: Profile;
  // Other top-level keys (applications[], sync_completed, etc.) pass
  // through. Same forward-compat reasoning as Profile above.
  [extra: string]: unknown;
};

/**
 * Read the stored state. Returns `{}` for missing / corrupted data;
 * never throws. SSR-safe (returns `{}` when window is undefined).
 */
export function loadCareerBuddyState(): CareerBuddyState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CareerBuddyState;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Write the state. Best-effort; quota errors swallowed since the UI
 * can rebuild from defaults.
 */
export function saveCareerBuddyState(state: CareerBuddyState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / SecurityError */
  }
}

/**
 * Merge an analyze-cv response into the stored state's profile. Pure
 * function — takes the prior state, returns the new state. Caller
 * persists via `saveCareerBuddyState`.
 *
 * Merge rules (preserve existing user input where the analysis has
 * nothing meaningful to add):
 *  - boolean flags overwrite (built: true, cv_analyzed: true)
 *  - cv_filename, cv_summary, cv_fit_score overwrite
 *  - name, headline: trimmed analysis value WINS if non-empty,
 *    otherwise prior value sticks
 *  - array fields (strengths, gaps, recommendations,
 *    target_role_categories, location_preferences): non-empty
 *    analysis array WINS, otherwise prior array sticks
 *  - any other profile fields the user filled (target_role,
 *    target_geo, work_history, …) pass through unchanged via spread
 */
export function mergeAnalysisIntoState(
  state: CareerBuddyState,
  analysis: CvAnalysisResponse,
  cvFilename: string,
): CareerBuddyState {
  const prior = state.profile ?? {};
  const next: Profile = {
    ...prior,
    built: true,
    cv_analyzed: true,
    cv_filename: cvFilename,
    cv_summary: analysis.summary ?? null,
    cv_fit_score:
      typeof analysis.fit_score === "number" ? analysis.fit_score : null,
    name: analysis.name?.trim() || prior.name || "",
    headline: analysis.headline?.trim() || prior.headline || "",
    strengths: analysis.strengths?.length ? analysis.strengths : (prior.strengths ?? []),
    gaps: analysis.gaps?.length ? analysis.gaps : (prior.gaps ?? []),
    recommendations: analysis.recommendations?.length
      ? analysis.recommendations
      : (prior.recommendations ?? []),
    target_role_categories: analysis.target_role_categories?.length
      ? analysis.target_role_categories
      : (prior.target_role_categories ?? []),
    location_preferences: analysis.location_preferences?.length
      ? analysis.location_preferences
      : (prior.location_preferences ?? []),
    skills: analysis.skills?.length ? analysis.skills : (prior.skills ?? []),
  };
  return { ...state, profile: next };
}
