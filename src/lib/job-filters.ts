/**
 * Job-feed filter + sort logic lifted from CareerBuddy.tsx.
 *
 * Pure functions only. The filter UI lives in the monolith (and will
 * eventually live in `src/components/roles/FilterBar.tsx`); the
 * filter LOGIC lives here so /jobs route can reuse the same filtering
 * engine without dragging the monolith along.
 *
 * Public surface:
 *  - {@link Filters}, {@link SortKey}, {@link JobLevel} — types
 *  - {@link DEFAULT_FILTERS} — empty filter set
 *  - {@link serializeFilters} / {@link parseFiltersFromHash} — URL hash
 *    persistence (encode + decode)
 *  - {@link countActiveFilters} — how many filter dimensions are non-default
 *  - {@link applyFilters} — VcJob[] + Filters + dismissed-Set → VcJob[]
 *  - {@link sortJobs} — comparator factory for ScoredJob
 */

export type JobLevel =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "principal"
  | "executive";

export type SortKey = "fit" | "recency" | "company" | "years_asc" | "salary_desc";

export type Filters = {
  roleCats: string[];
  atsSources: string[];
  locationQuery: string;
  postedSince: "any" | "today" | "week" | "month";
  remoteOnly: boolean;
  hideRemote: boolean;
  languages: string[];
  maxYearsRequired: number | null;
  sort: SortKey;
  levels: JobLevel[];
  countries: string[];
  visaSponsorshipOnly: boolean;
  internationalOnly: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  roleCats: [],
  atsSources: [],
  locationQuery: "",
  postedSince: "any",
  remoteOnly: false,
  hideRemote: false,
  languages: [],
  maxYearsRequired: null,
  sort: "fit",
  levels: [],
  countries: [],
  visaSponsorshipOnly: false,
  internationalOnly: false,
};

/**
 * Structural shape of a job row used by the filter engine. Subset of
 * the monolith's full VcJob; filter consumers pass their richer shape
 * unchanged via duck-typing.
 */
export type FilterableJob = {
  url: string;
  role_category: string | null;
  ats_source: string;
  location: string;
  is_remote: boolean;
  posted_date: string | null;
  languages_required: string[];
  years_min: number | null;
  level: JobLevel | null;
  country: string | null;
  visa_sponsorship: boolean | null;
  is_international: boolean;
};

/** Structural shape needed for sortJobs. */
export type SortableJob = {
  fit: number;
  posted_date: string | null;
  company: string;
  years_min: number | null;
  salary_min: number | null;
};

const VALID_LEVELS: readonly JobLevel[] = [
  "intern",
  "junior",
  "mid",
  "senior",
  "lead",
  "principal",
  "executive",
];

export function serializeFilters(f: Filters): string {
  const params = new URLSearchParams();
  if (f.roleCats.length) params.set("cats", f.roleCats.join(","));
  if (f.atsSources.length) params.set("ats", f.atsSources.join(","));
  if (f.locationQuery.trim()) params.set("loc", f.locationQuery.trim());
  if (f.postedSince !== "any") params.set("since", f.postedSince);
  if (f.remoteOnly) params.set("remote", "1");
  if (f.hideRemote) params.set("hide_remote", "1");
  if (f.languages.length) params.set("langs", f.languages.join(","));
  if (f.maxYearsRequired !== null) params.set("max_years", String(f.maxYearsRequired));
  if (f.sort !== "fit") params.set("sort", f.sort);
  if (f.levels.length) params.set("levels", f.levels.join(","));
  if (f.countries.length) params.set("countries", f.countries.join(","));
  if (f.visaSponsorshipOnly) params.set("visa", "1");
  if (f.internationalOnly) params.set("international", "1");
  return params.toString();
}

export function parseFiltersFromHash(hash: string): Filters {
  const out: Filters = { ...DEFAULT_FILTERS };
  if (!hash || hash.length < 2) return out;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const cats = params.get("cats");
  if (cats) out.roleCats = cats.split(",").filter(Boolean);
  const ats = params.get("ats");
  if (ats) out.atsSources = ats.split(",").filter(Boolean);
  const loc = params.get("loc");
  if (loc) out.locationQuery = loc;
  const since = params.get("since");
  if (since === "today" || since === "week" || since === "month") out.postedSince = since;
  if (params.get("remote") === "1") out.remoteOnly = true;
  if (params.get("hide_remote") === "1") out.hideRemote = true;
  const langs = params.get("langs");
  if (langs) out.languages = langs.split(",").filter(Boolean);
  const maxY = params.get("max_years");
  if (maxY && /^\d+$/.test(maxY)) out.maxYearsRequired = parseInt(maxY, 10);
  const sort = params.get("sort");
  if (sort === "recency" || sort === "company" || sort === "years_asc" || sort === "salary_desc") {
    out.sort = sort;
  }
  const levels = params.get("levels");
  if (levels) {
    out.levels = levels
      .split(",")
      .filter((x): x is JobLevel => (VALID_LEVELS as readonly string[]).includes(x));
  }
  const countries = params.get("countries");
  if (countries) out.countries = countries.split(",").filter(Boolean);
  if (params.get("visa") === "1") out.visaSponsorshipOnly = true;
  if (params.get("international") === "1") out.internationalOnly = true;
  return out;
}

export function countActiveFilters(f: Filters): number {
  let n = 0;
  if (f.roleCats.length > 0) n++;
  if (f.atsSources.length > 0) n++;
  if (f.locationQuery.trim()) n++;
  if (f.postedSince !== "any") n++;
  if (f.remoteOnly) n++;
  if (f.hideRemote) n++;
  if (f.languages.length > 0) n++;
  if (f.maxYearsRequired !== null) n++;
  if (f.levels.length > 0) n++;
  if (f.countries.length > 0) n++;
  if (f.visaSponsorshipOnly) n++;
  if (f.internationalOnly) n++;
  return n;
}

export function applyFilters<J extends FilterableJob>(
  jobs: J[],
  f: Filters,
  dismissed: Set<string>,
): J[] {
  const locQ = f.locationQuery.trim().toLowerCase();
  const now = Date.now();
  const sinceMs =
    f.postedSince === "today"
      ? 86_400_000
      : f.postedSince === "week"
        ? 7 * 86_400_000
        : f.postedSince === "month"
          ? 30 * 86_400_000
          : 0;
  return jobs.filter((j) => {
    if (dismissed.has(j.url)) return false;
    if (f.roleCats.length > 0) {
      if (!j.role_category || !f.roleCats.includes(j.role_category)) return false;
    }
    if (f.atsSources.length > 0) {
      if (!f.atsSources.includes(j.ats_source)) return false;
    }
    if (locQ && !(j.location || "").toLowerCase().includes(locQ)) return false;
    if (f.remoteOnly && !j.is_remote) return false;
    if (f.hideRemote && j.is_remote) return false;
    if (sinceMs && j.posted_date) {
      const age = now - new Date(j.posted_date).getTime();
      if (age > sinceMs) return false;
    } else if (sinceMs && !j.posted_date) {
      return false;
    }
    if (f.languages.length > 0) {
      // Match if the JD requires any of the selected languages OR doesn't specify.
      if (j.languages_required.length > 0) {
        const requiredLower = j.languages_required.map((l) => l.toLowerCase());
        const wantsLower = f.languages.map((l) => l.toLowerCase());
        if (!wantsLower.some((w) => requiredLower.includes(w))) return false;
      }
    }
    if (f.maxYearsRequired !== null && j.years_min !== null && j.years_min > f.maxYearsRequired) {
      return false;
    }
    if (f.levels.length > 0) {
      if (!j.level || !f.levels.includes(j.level)) return false;
    }
    if (f.countries.length > 0) {
      if (!j.country || !f.countries.includes(j.country)) return false;
    }
    if (f.visaSponsorshipOnly && j.visa_sponsorship !== true) return false;
    if (f.internationalOnly && !j.is_international) return false;
    return true;
  });
}

export function sortJobs<J extends SortableJob>(a: J, b: J, key: SortKey): number {
  switch (key) {
    case "recency": {
      const ad = a.posted_date ? new Date(a.posted_date).getTime() : 0;
      const bd = b.posted_date ? new Date(b.posted_date).getTime() : 0;
      if (bd !== ad) return bd - ad;
      return b.fit - a.fit;
    }
    case "company":
      return a.company.localeCompare(b.company);
    case "years_asc": {
      const ay = a.years_min ?? 99;
      const by = b.years_min ?? 99;
      if (ay !== by) return ay - by;
      return b.fit - a.fit;
    }
    case "salary_desc": {
      const as = a.salary_min ?? -1;
      const bs = b.salary_min ?? -1;
      if (bs !== as) return bs - as;
      return b.fit - a.fit;
    }
    case "fit":
    default: {
      if (b.fit !== a.fit) return b.fit - a.fit;
      const ad = a.posted_date ? new Date(a.posted_date).getTime() : 0;
      const bd = b.posted_date ? new Date(b.posted_date).getTime() : 0;
      return bd - ad;
    }
  }
}
