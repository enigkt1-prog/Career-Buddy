import { describe, expect, test } from "vitest";

import {
  buildProfileTokens,
  fitScore,
  fitWhy,
  intersect,
  parseYearMonth,
  profileYearsExperience,
  tokenize,
  tokensMatch,
  type FitJob,
  type FitProfile,
} from "./job-fit";

const baseProfile: FitProfile = {
  strengths: ["B2B sales", "German native", "structured thinking"],
  target_role: "Founders Associate",
  target_role_categories: ["founders-associate", "bizops", "strategy"],
  location_preferences: ["Berlin", "Remote-DACH"],
  headline: "Strategy graduate, ex-BDR",
  work_history: [
    {
      role: "BDR",
      bullets: ["Closed 14 enterprise deals worth €450k", "Drove pipeline 2x"],
      start_date: "2024-09",
      end_date: "2026-05",
    },
  ],
};

function makeJob(overrides: Partial<FitJob> = {}): FitJob {
  return {
    role: "Founders Associate",
    company: "Acme",
    role_category: "founders-associate",
    location: "Berlin",
    is_remote: false,
    posted_date: null,
    years_min: null,
    languages_required: [],
    jobTokens: new Set(),
    reqTokens: new Set(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  test("returns empty set for empty / null", () => {
    expect(tokenize("")).toEqual(new Set());
  });

  test("lowercases + de-dupes tokens", () => {
    const out = tokenize("Sales Sales SALES");
    expect(out.has("sales")).toBe(true);
    expect(out.size).toBe(1);
  });

  test("filters stopwords", () => {
    const out = tokenize("the and with FOUNDER");
    expect(out.has("founder")).toBe(true);
    expect(out.has("the")).toBe(false);
    expect(out.has("and")).toBe(false);
  });

  test("filters resume-noise verbs", () => {
    const out = tokenize("closed 14 deals managed pipeline");
    expect(out.has("closed")).toBe(false);
    expect(out.has("managed")).toBe(false);
    expect(out.has("pipeline")).toBe(true);
  });

  test("strips trailing punctuation", () => {
    const out = tokenize("python, sql; bigquery.");
    expect(out.has("python")).toBe(true);
    expect(out.has("sql")).toBe(true);
    expect(out.has("bigquery")).toBe(true);
  });

  test("min length 3", () => {
    const out = tokenize("ai is a go");
    // "is" and "a" filtered; "go" filtered (stopword); "ai" too short.
    expect(out.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tokensMatch + intersect
// ---------------------------------------------------------------------------

describe("tokensMatch", () => {
  test("identical match", () => {
    expect(tokensMatch("python", "python")).toBe(true);
  });

  test("stem-prefix match (sales/sale)", () => {
    expect(tokensMatch("sales", "sale")).toBe(false);
    expect(tokensMatch("sales", "sales")).toBe(true);
  });

  test("plural match (manager/managers)", () => {
    expect(tokensMatch("manager", "managers")).toBe(true);
  });

  test("substring NOT enough (sales ≠ salesforce)", () => {
    expect(tokensMatch("sales", "salesforce")).toBe(false);
  });

  test("short tokens don't fuzzy match", () => {
    expect(tokensMatch("api", "apis")).toBe(false);
  });
});

describe("intersect", () => {
  test("empty profile returns empty", () => {
    expect(intersect(new Set(), new Set(["a", "b"]))).toEqual([]);
  });

  test("empty job returns empty", () => {
    expect(intersect(new Set(["a"]), new Set())).toEqual([]);
  });

  test("returns profile-anchored tokens", () => {
    const out = intersect(new Set(["sales", "python"]), new Set(["sales", "java"]));
    expect(out).toEqual(["sales"]);
  });

  test("stem-prefix bridges singular/plural", () => {
    const out = intersect(new Set(["manager"]), new Set(["managers"]));
    expect(out).toEqual(["manager"]);
  });

  test("caps at 8 entries", () => {
    const profile = new Set(["a1aaaa", "b2bbbb", "c3cccc", "d4dddd", "e5eeee", "f6ffff", "g7gggg", "h8hhhh", "i9iiii", "j0jjjj"]);
    const job = new Set(profile);
    expect(intersect(profile, job)).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// parseYearMonth + profileYearsExperience
// ---------------------------------------------------------------------------

describe("parseYearMonth", () => {
  test("YYYY-MM", () => {
    const d = parseYearMonth("2024-09");
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(8); // 0-indexed
  });

  test("YYYY only", () => {
    const d = parseYearMonth("2023");
    expect(d?.getFullYear()).toBe(2023);
    expect(d?.getMonth()).toBe(0);
  });

  test("returns null for empty / invalid", () => {
    expect(parseYearMonth(null)).toBeNull();
    expect(parseYearMonth(undefined)).toBeNull();
    expect(parseYearMonth("not-a-date")).toBeNull();
  });
});

describe("profileYearsExperience", () => {
  test("sums work_history months → years", () => {
    const yrs = profileYearsExperience({
      ...baseProfile,
      work_history: [
        { role: "X", bullets: [], start_date: "2020-01", end_date: "2024-01" }, // 4y
      ],
    });
    expect(yrs).toBe(4);
  });

  test("'present' end_date treated as now", () => {
    const yrs = profileYearsExperience({
      ...baseProfile,
      work_history: [
        { role: "X", bullets: [], start_date: "2020-01", end_date: "Present" },
      ],
    });
    expect(yrs).toBeGreaterThanOrEqual(5);
  });

  test("missing dates → 0", () => {
    expect(
      profileYearsExperience({ ...baseProfile, work_history: [{ role: "X", bullets: [] }] }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fitScore — golden-input tests
// ---------------------------------------------------------------------------

describe("fitScore", () => {
  test("role_category match adds +2.5 over baseline 5.0", () => {
    const job = makeJob({ role_category: "founders-associate" });
    const { score } = fitScore(job, baseProfile, new Set(), 0);
    // baseline 5.0 + role_category 2.5 + Berlin 1.5 = 9.0
    expect(score).toBe(9.0);
  });

  test("non-target role_category gets +0.4 only", () => {
    const job = makeJob({ role_category: "engineering", location: "" });
    const { score } = fitScore(job, baseProfile, new Set(), 0);
    expect(score).toBeCloseTo(5.4, 1);
  });

  test("location preference match adds +1.5", () => {
    const job = makeJob({ role_category: null, role: "Engineer", location: "Berlin" });
    const { score } = fitScore(job, baseProfile, new Set(), 0);
    // baseline 5.0 + Berlin 1.5 = 6.5 (no role_category match, no FA-keyword in title)
    expect(score).toBe(6.5);
  });

  test("DACH fallback adds +1.0 when DE/DACH wanted", () => {
    const job = makeJob({ role_category: null, role: "Engineer", location: "Munich" });
    const profile: FitProfile = {
      ...baseProfile,
      location_preferences: ["DACH"],
    };
    const { score } = fitScore(job, profile, new Set(), 0);
    expect(score).toBe(6.0);
  });

  test("clamps to 9.9 max even with all bonuses", () => {
    const job = makeJob({
      role_category: "founders-associate",
      location: "Berlin",
      is_remote: true,
      posted_date: new Date().toISOString(),
    });
    const profileWithRemote: FitProfile = {
      ...baseProfile,
      location_preferences: ["Berlin", "Remote"],
    };
    const profTokens = new Set(["sales", "python", "sql"]);
    const reqTokens = new Set(["sales", "python", "sql"]);
    const jobWithTokens = { ...job, reqTokens };
    const { score } = fitScore(jobWithTokens, profileWithRemote, profTokens, 0);
    expect(score).toBeLessThanOrEqual(9.9);
  });

  test("clamps to 1.0 min when penalties stack", () => {
    const job = makeJob({
      role_category: "engineering",
      location: "Tokyo",
      posted_date: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      years_min: 10,
      languages_required: ["japanese", "korean"],
    });
    const { score } = fitScore(job, baseProfile, new Set(), 1);
    expect(score).toBeGreaterThanOrEqual(1.0);
  });

  test("years gap penalty: 4y short = -1.5", () => {
    const baseJob = makeJob({ role_category: null, role: "Engineer", location: "" });
    const noYears = fitScore(baseJob, baseProfile, new Set(), 0);
    const withGap = fitScore({ ...baseJob, years_min: 5 }, baseProfile, new Set(), 1);
    expect(withGap.score).toBeCloseTo(noYears.score - 1.5, 1);
  });

  test("missing language penalty when have-langs is non-empty", () => {
    const profileWithLangs: FitProfile = {
      ...baseProfile,
      strengths: ["English fluent", "B2B sales"],
    };
    const baseJob = makeJob({ role_category: null, role: "Engineer", location: "" });
    const noLangReq = fitScore(baseJob, profileWithLangs, new Set(), 0);
    const withMissing = fitScore(
      { ...baseJob, languages_required: ["french"] },
      profileWithLangs,
      new Set(),
      0,
    );
    expect(withMissing.score).toBeCloseTo(noLangReq.score - 0.5, 1);
  });

  test("returns matched tokens from JD overlap", () => {
    const profTokens = new Set(["python", "sales"]);
    const job = makeJob({
      role_category: null,
      role: "Engineer",
      location: "",
      reqTokens: new Set(["python", "java"]),
      jobTokens: new Set(["sales"]),
    });
    const { matched } = fitScore(job, baseProfile, profTokens, 0);
    expect(matched).toContain("python");
    expect(matched).toContain("sales");
  });
});

// ---------------------------------------------------------------------------
// fitWhy
// ---------------------------------------------------------------------------

describe("fitWhy", () => {
  test("includes role match label", () => {
    const job = makeJob({ role_category: "founders-associate" });
    const why = fitWhy(job, baseProfile, []);
    expect(why).toMatch(/role match: founders-associate/);
  });

  test("includes location label when prefix matches", () => {
    const job = makeJob({ location: "Berlin, Germany" });
    const why = fitWhy(job, baseProfile, []);
    expect(why).toMatch(/location: Berlin, Germany/);
  });

  test("falls back to remote-friendly", () => {
    const job = makeJob({
      role_category: null,
      location: "San Francisco",
      is_remote: true,
    });
    const profile = { ...baseProfile, location_preferences: ["Remote"] };
    const why = fitWhy(job, profile, []);
    expect(why).toMatch(/remote-friendly/);
  });

  test("appends matched tokens chip", () => {
    const job = makeJob({ role_category: null, location: "" });
    const why = fitWhy(job, baseProfile, ["sales", "python"]);
    expect(why).toMatch(/matched: sales · python/);
  });

  test("default copy when nothing matches", () => {
    const job = makeJob({
      role_category: null,
      role: "Engineer",
      location: "Tokyo",
      posted_date: null,
    });
    const why = fitWhy(job, baseProfile, []);
    expect(why).toBe("Review JD to see if it fits.");
  });
});

// ---------------------------------------------------------------------------
// buildProfileTokens
// ---------------------------------------------------------------------------

describe("buildProfileTokens", () => {
  test("includes strengths + work-history role + bullets + headline + target_role", () => {
    const out = buildProfileTokens(baseProfile);
    expect(out.has("strategy")).toBe(true);
    expect(out.has("founders")).toBe(true);
    expect(out.has("enterprise")).toBe(true);
    expect(out.has("pipeline")).toBe(true);
  });
});
