/**
 * Career-Buddy state load/persist + profile-shape migration.
 *
 * Lifted from CareerBuddy.tsx without functional changes. Reads
 * `career-buddy-state` localStorage key (cv-storage owns the bare
 * STORAGE_KEY constant). All loaders are defensive — corrupted JSON
 * or missing fields fall back to {@link emptyState} / DEFAULT_PROFILE.
 */

import { STORAGE_KEY, type CvRadar } from "./cv-storage";
import {
  DEFAULT_PROFILE,
  SEED_APPS,
  type Application,
  type Education,
  type Position,
  type Profile,
  type SkillEntry,
  type SkillLevel,
  type State,
} from "./types";

const VALID_SKILL_LEVELS: ReadonlySet<SkillLevel> = new Set([
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);

function migrateSkill(entry: unknown): SkillEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (!name) return null;
  const out: SkillEntry = { name };
  if (typeof e.level === "string" && VALID_SKILL_LEVELS.has(e.level as SkillLevel)) {
    out.level = e.level as SkillLevel;
  }
  if (typeof e.years === "number" && Number.isFinite(e.years)) {
    out.years = Math.max(0, Math.min(50, e.years));
  }
  if (typeof e.evidence === "string" && e.evidence.trim()) {
    out.evidence = e.evidence.trim();
  }
  return out;
}

/**
 * Carry a persisted CV radar through unchanged. analyze-cv Zod-
 * validated the shape on write, so a light structural check (an
 * object with a non-empty `axes` array) is enough; anything else
 * drops to `undefined`.
 */
function migrateRadar(raw: unknown): CvRadar | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const axes = (raw as Record<string, unknown>).axes;
  if (!Array.isArray(axes) || axes.length === 0) return undefined;
  return raw as CvRadar;
}

export function emptyState(): State {
  return {
    applications: [],
    profile: { ...DEFAULT_PROFILE },
    sync_completed: false,
    dismissed_urls: [],
  };
}

/**
 * Coerce a raw localStorage value into a {@link Profile}. Missing or
 * wrong-type fields fall back to DEFAULT_PROFILE; arrays filter to
 * strings; work_history / education entries get a generated id when
 * missing so React keys stay stable.
 */
export function migrateProfile(raw: unknown): Profile {
  const base = { ...DEFAULT_PROFILE };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const arr = (k: string): string[] =>
    Array.isArray(r[k])
      ? (r[k] as unknown[]).filter((x) => typeof x === "string") as string[]
      : (base[k as keyof Profile] as string[]);
  const str = (k: string, fb: string): string =>
    typeof r[k] === "string" ? (r[k] as string) : fb;
  const num = (k: string): number | null =>
    typeof r[k] === "number" ? (r[k] as number) : null;
  return {
    built: r.built === true,
    cv_analyzed: r.cv_analyzed === true,
    collapsed: r.collapsed === true,
    name: str("name", ""),
    target_role: str("target_role", base.target_role),
    target_geo: str("target_geo", base.target_geo),
    background: str("background", base.background),
    headline: str("headline", ""),
    strengths: arr("strengths"),
    gaps: arr("gaps"),
    recommendations: arr("recommendations"),
    target_role_categories: arr("target_role_categories"),
    location_preferences: arr("location_preferences"),
    work_history: Array.isArray(r.work_history)
      ? (r.work_history as Position[]).map((p, i) => ({
          ...p,
          id: p.id || `w${i}_${Date.now()}`,
        }))
      : [],
    education: Array.isArray(r.education)
      ? (r.education as Education[]).map((e, i) => ({
          ...e,
          id: e.id || `e${i}_${Date.now()}`,
        }))
      : [],
    skills: Array.isArray(r.skills)
      ? (r.skills.map(migrateSkill).filter(Boolean) as SkillEntry[])
      : [],
    cv_filename: typeof r.cv_filename === "string" ? r.cv_filename : null,
    cv_summary: typeof r.cv_summary === "string" ? r.cv_summary : null,
    cv_fit_score: num("cv_fit_score"),
    // F2: preserve the radar + the Supabase freshness timestamp so an
    // Overview mount (setState(loadState())) does not strip them.
    radar: migrateRadar(r.radar),
    updated_at: typeof r.updated_at === "string" ? r.updated_at : undefined,
  };
}

export function loadState(): State {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as {
      applications?: Application[];
      profile?: unknown;
      sync_completed?: boolean;
      dismissed_urls?: unknown;
    };
    return {
      applications:
        Array.isArray(parsed.applications) && parsed.applications.length > 0
          ? parsed.applications
          : SEED_APPS,
      profile: migrateProfile(parsed.profile),
      sync_completed: parsed.sync_completed === true,
      dismissed_urls: Array.isArray(parsed.dismissed_urls)
        ? (parsed.dismissed_urls.filter((x) => typeof x === "string") as string[])
        : [],
    };
  } catch {
    return emptyState();
  }
}
