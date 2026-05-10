import { describe, expect, test } from "vitest";

import {
  DEFAULT_FILTERS,
  applyFilters,
  countActiveFilters,
  parseFiltersFromHash,
  serializeFilters,
  sortJobs,
  type FilterableJob,
  type Filters,
  type SortableJob,
} from "./job-filters";

function makeJob(overrides: Partial<FilterableJob> = {}): FilterableJob {
  return {
    url: "https://example.com/j/1",
    role_category: "founders-associate",
    ats_source: "greenhouse",
    location: "Berlin, Germany",
    is_remote: false,
    posted_date: new Date().toISOString(),
    languages_required: [],
    years_min: null,
    level: null,
    country: "DE",
    visa_sponsorship: null,
    is_international: false,
    ...overrides,
  };
}

function withFilters(overrides: Partial<Filters>): Filters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

// ---------------------------------------------------------------------------
// DEFAULT_FILTERS
// ---------------------------------------------------------------------------

describe("DEFAULT_FILTERS", () => {
  test("zero active filters by default", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// serializeFilters / parseFiltersFromHash
// ---------------------------------------------------------------------------

describe("serializeFilters + parseFiltersFromHash round-trip", () => {
  test("empty filters produce empty string", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
  });

  test("multi-select roleCats round-trip", () => {
    const f = withFilters({ roleCats: ["bizops", "strategy"] });
    const hash = serializeFilters(f);
    expect(parseFiltersFromHash(hash).roleCats).toEqual(["bizops", "strategy"]);
  });

  test("locationQuery round-trip preserves whitespace trim", () => {
    const f = withFilters({ locationQuery: "  Berlin  " });
    const hash = serializeFilters(f);
    expect(parseFiltersFromHash(hash).locationQuery).toBe("Berlin");
  });

  test("postedSince round-trip", () => {
    expect(parseFiltersFromHash(serializeFilters(withFilters({ postedSince: "week" }))).postedSince).toBe("week");
    expect(parseFiltersFromHash(serializeFilters(withFilters({ postedSince: "any" }))).postedSince).toBe("any");
  });

  test("boolean toggles round-trip", () => {
    const f = withFilters({ remoteOnly: true, visaSponsorshipOnly: true, internationalOnly: true });
    const out = parseFiltersFromHash(serializeFilters(f));
    expect(out.remoteOnly).toBe(true);
    expect(out.visaSponsorshipOnly).toBe(true);
    expect(out.internationalOnly).toBe(true);
  });

  test("max_years numeric round-trip", () => {
    const f = withFilters({ maxYearsRequired: 5 });
    expect(parseFiltersFromHash(serializeFilters(f)).maxYearsRequired).toBe(5);
  });

  test("sort defaults to fit", () => {
    expect(parseFiltersFromHash("").sort).toBe("fit");
  });

  test("sort round-trip with non-default", () => {
    const f = withFilters({ sort: "salary_desc" });
    expect(parseFiltersFromHash(serializeFilters(f)).sort).toBe("salary_desc");
  });

  test("invalid level dropped at parse", () => {
    const out = parseFiltersFromHash("levels=junior,not-a-level,senior");
    expect(out.levels).toEqual(["junior", "senior"]);
  });

  test("hash with leading # also parses", () => {
    expect(parseFiltersFromHash("#cats=bd").roleCats).toEqual(["bd"]);
  });

  test("empty hash returns DEFAULT", () => {
    expect(parseFiltersFromHash("")).toEqual(DEFAULT_FILTERS);
  });
});

// ---------------------------------------------------------------------------
// countActiveFilters
// ---------------------------------------------------------------------------

describe("countActiveFilters", () => {
  test("counts each active dimension once", () => {
    const f = withFilters({
      roleCats: ["bd"],
      remoteOnly: true,
      maxYearsRequired: 3,
      visaSponsorshipOnly: true,
    });
    expect(countActiveFilters(f)).toBe(4);
  });

  test("empty arrays do not count", () => {
    const f = withFilters({ roleCats: [], languages: [] });
    expect(countActiveFilters(f)).toBe(0);
  });

  test("locationQuery whitespace doesn't count", () => {
    expect(countActiveFilters(withFilters({ locationQuery: "   " }))).toBe(0);
    expect(countActiveFilters(withFilters({ locationQuery: "Berlin" }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

describe("applyFilters", () => {
  test("no filters → all jobs except dismissed", () => {
    const jobs = [makeJob({ url: "a" }), makeJob({ url: "b" })];
    const out = applyFilters(jobs, DEFAULT_FILTERS, new Set(["a"]));
    expect(out.map((j) => j.url)).toEqual(["b"]);
  });

  test("roleCats filter — only matching", () => {
    const jobs = [
      makeJob({ url: "1", role_category: "bd" }),
      makeJob({ url: "2", role_category: "engineering" }),
    ];
    const out = applyFilters(jobs, withFilters({ roleCats: ["bd"] }), new Set());
    expect(out.map((j) => j.url)).toEqual(["1"]);
  });

  test("ats filter", () => {
    const jobs = [
      makeJob({ url: "1", ats_source: "greenhouse" }),
      makeJob({ url: "2", ats_source: "lever" }),
    ];
    const out = applyFilters(jobs, withFilters({ atsSources: ["lever"] }), new Set());
    expect(out.map((j) => j.url)).toEqual(["2"]);
  });

  test("locationQuery substring (case-insensitive)", () => {
    const jobs = [
      makeJob({ url: "1", location: "Berlin, Germany" }),
      makeJob({ url: "2", location: "Munich, Germany" }),
    ];
    const out = applyFilters(jobs, withFilters({ locationQuery: "berlin" }), new Set());
    expect(out.map((j) => j.url)).toEqual(["1"]);
  });

  test("remoteOnly toggle", () => {
    const jobs = [
      makeJob({ url: "1", is_remote: true }),
      makeJob({ url: "2", is_remote: false }),
    ];
    expect(
      applyFilters(jobs, withFilters({ remoteOnly: true }), new Set()).map((j) => j.url),
    ).toEqual(["1"]);
  });

  test("hideRemote toggle", () => {
    const jobs = [
      makeJob({ url: "1", is_remote: true }),
      makeJob({ url: "2", is_remote: false }),
    ];
    expect(
      applyFilters(jobs, withFilters({ hideRemote: true }), new Set()).map((j) => j.url),
    ).toEqual(["2"]);
  });

  test("postedSince=week drops older + null posted_date", () => {
    const old = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    const jobs = [
      makeJob({ url: "old", posted_date: old }),
      makeJob({ url: "recent", posted_date: recent }),
      makeJob({ url: "null-date", posted_date: null }),
    ];
    const out = applyFilters(jobs, withFilters({ postedSince: "week" }), new Set());
    expect(out.map((j) => j.url)).toEqual(["recent"]);
  });

  test("languages — JD requires any selected (or none required)", () => {
    const jobs = [
      makeJob({ url: "english-required", languages_required: ["English"] }),
      makeJob({ url: "german-required", languages_required: ["German"] }),
      makeJob({ url: "no-langs", languages_required: [] }),
    ];
    const out = applyFilters(jobs, withFilters({ languages: ["English"] }), new Set());
    expect(out.map((j) => j.url)).toEqual(["english-required", "no-langs"]);
  });

  test("maxYearsRequired — drops jobs requiring more", () => {
    const jobs = [
      makeJob({ url: "junior", years_min: 1 }),
      makeJob({ url: "mid", years_min: 4 }),
      makeJob({ url: "senior", years_min: 7 }),
      makeJob({ url: "no-years", years_min: null }),
    ];
    const out = applyFilters(jobs, withFilters({ maxYearsRequired: 5 }), new Set());
    expect(out.map((j) => j.url)).toEqual(["junior", "mid", "no-years"]);
  });

  test("levels filter", () => {
    const jobs = [
      makeJob({ url: "j", level: "junior" }),
      makeJob({ url: "s", level: "senior" }),
      makeJob({ url: "u", level: null }),
    ];
    expect(
      applyFilters(jobs, withFilters({ levels: ["junior"] }), new Set()).map((j) => j.url),
    ).toEqual(["j"]);
  });

  test("countries filter", () => {
    const jobs = [makeJob({ url: "de", country: "DE" }), makeJob({ url: "us", country: "US" })];
    expect(
      applyFilters(jobs, withFilters({ countries: ["DE"] }), new Set()).map((j) => j.url),
    ).toEqual(["de"]);
  });

  test("visaSponsorshipOnly only keeps explicit yes", () => {
    const jobs = [
      makeJob({ url: "yes", visa_sponsorship: true }),
      makeJob({ url: "no", visa_sponsorship: false }),
      makeJob({ url: "unknown", visa_sponsorship: null }),
    ];
    expect(
      applyFilters(jobs, withFilters({ visaSponsorshipOnly: true }), new Set()).map((j) => j.url),
    ).toEqual(["yes"]);
  });

  test("internationalOnly", () => {
    const jobs = [
      makeJob({ url: "intl", is_international: true }),
      makeJob({ url: "local", is_international: false }),
    ];
    expect(
      applyFilters(jobs, withFilters({ internationalOnly: true }), new Set()).map((j) => j.url),
    ).toEqual(["intl"]);
  });
});

// ---------------------------------------------------------------------------
// sortJobs
// ---------------------------------------------------------------------------

function makeScored(overrides: Partial<SortableJob> = {}): SortableJob {
  return {
    fit: 5,
    posted_date: null,
    company: "Acme",
    years_min: null,
    salary_min: null,
    ...overrides,
  };
}

describe("sortJobs", () => {
  test("fit (default) — descending fit, then descending recency", () => {
    const a = makeScored({ fit: 7, posted_date: "2026-05-01" });
    const b = makeScored({ fit: 9, posted_date: "2026-04-01" });
    expect(sortJobs(a, b, "fit")).toBeGreaterThan(0); // b first
    const c = makeScored({ fit: 7, posted_date: "2026-05-01" });
    const d = makeScored({ fit: 7, posted_date: "2026-03-01" });
    expect(sortJobs(c, d, "fit")).toBeLessThan(0); // c first (more recent)
  });

  test("recency — descending posted_date", () => {
    const a = makeScored({ fit: 5, posted_date: "2026-01-01" });
    const b = makeScored({ fit: 5, posted_date: "2026-05-01" });
    expect(sortJobs(a, b, "recency")).toBeGreaterThan(0); // b first
  });

  test("company — alphabetical", () => {
    const a = makeScored({ company: "Zebra" });
    const b = makeScored({ company: "Acme" });
    expect(sortJobs(a, b, "company")).toBeGreaterThan(0); // b first
  });

  test("years_asc — lower years_min first", () => {
    const a = makeScored({ years_min: 5 });
    const b = makeScored({ years_min: 1 });
    expect(sortJobs(a, b, "years_asc")).toBeGreaterThan(0); // b first
  });

  test("years_asc — null treated as 99 (sinks to bottom)", () => {
    const a = makeScored({ years_min: 5 });
    const b = makeScored({ years_min: null });
    expect(sortJobs(a, b, "years_asc")).toBeLessThan(0); // a first
  });

  test("salary_desc — higher salary first", () => {
    const a = makeScored({ salary_min: 50_000 });
    const b = makeScored({ salary_min: 90_000 });
    expect(sortJobs(a, b, "salary_desc")).toBeGreaterThan(0); // b first
  });
});
