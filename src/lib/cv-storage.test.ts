import { describe, expect, test } from "vitest";

import {
  STORAGE_KEY,
  loadCareerBuddyState,
  mergeAnalysisIntoState,
  saveCareerBuddyState,
  type CareerBuddyState,
  type CvAnalysisResponse,
} from "./cv-storage";

describe("STORAGE_KEY", () => {
  test("matches the live monolith key (no -v1 suffix)", () => {
    expect(STORAGE_KEY).toBe("career-buddy-state");
  });
});

describe("loadCareerBuddyState", () => {
  test("returns {} on empty storage", () => {
    expect(loadCareerBuddyState()).toEqual({});
  });

  test("returns parsed state when present", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { name: "Troels" } }),
    );
    expect(loadCareerBuddyState()).toEqual({ profile: { name: "Troels" } });
  });

  test("returns {} on corrupted JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadCareerBuddyState()).toEqual({});
  });

  test("returns {} when stored value is an array (not an object)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadCareerBuddyState()).toEqual({});
  });

  test("returns {} when stored value is null", () => {
    localStorage.setItem(STORAGE_KEY, "null");
    expect(loadCareerBuddyState()).toEqual({});
  });
});

describe("saveCareerBuddyState", () => {
  test("writes JSON-stringified state", () => {
    const state: CareerBuddyState = { profile: { name: "Alex" }, sync_completed: true };
    saveCareerBuddyState(state);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual(state);
  });

  test("round-trips load → save → load", () => {
    const state: CareerBuddyState = {
      profile: { name: "Round Trip", strengths: ["a", "b"] },
      applications: [{ id: 1 }],
    };
    saveCareerBuddyState(state);
    expect(loadCareerBuddyState()).toEqual(state);
  });
});

describe("mergeAnalysisIntoState", () => {
  const baseAnalysis: CvAnalysisResponse = {
    summary: "Strong B2B sales background, looking for FA roles.",
    fit_score: 7.5,
    strengths: ["B2B sales", "German native"],
    gaps: ["No SaaS PM experience"],
    recommendations: ["Apply to BizOps + Strategy"],
    target_role_categories: ["bizops", "strategy"],
    location_preferences: ["Berlin", "Munich"],
    name: "  Troels Enigk  ",
    headline: "  CLSBE Master, ex-BDR  ",
  };

  test("flips built + cv_analyzed flags", () => {
    const out = mergeAnalysisIntoState({}, baseAnalysis, "cv.pdf");
    expect(out.profile?.built).toBe(true);
    expect(out.profile?.cv_analyzed).toBe(true);
  });

  test("trims name + headline before assigning", () => {
    const out = mergeAnalysisIntoState({}, baseAnalysis, "cv.pdf");
    expect(out.profile?.name).toBe("Troels Enigk");
    expect(out.profile?.headline).toBe("CLSBE Master, ex-BDR");
  });

  test("cv_filename stamped from caller", () => {
    const out = mergeAnalysisIntoState({}, baseAnalysis, "career-2026.pdf");
    expect(out.profile?.cv_filename).toBe("career-2026.pdf");
  });

  test("preserves existing profile fields not in analysis (target_role, target_geo)", () => {
    const prior: CareerBuddyState = {
      profile: { target_role: "Founders Associate", target_geo: "Berlin", custom: "keep me" },
    };
    const out = mergeAnalysisIntoState(prior, baseAnalysis, "cv.pdf");
    expect(out.profile?.target_role).toBe("Founders Associate");
    expect(out.profile?.target_geo).toBe("Berlin");
    expect(out.profile?.custom).toBe("keep me");
  });

  test("preserves prior array field when analysis array is empty", () => {
    const prior: CareerBuddyState = {
      profile: { strengths: ["existing-strength"] },
    };
    const stripped: CvAnalysisResponse = { ...baseAnalysis, strengths: [] };
    const out = mergeAnalysisIntoState(prior, stripped, "cv.pdf");
    expect(out.profile?.strengths).toEqual(["existing-strength"]);
  });

  test("prior name kept when analysis name is empty/whitespace", () => {
    const prior: CareerBuddyState = { profile: { name: "Existing Name" } };
    const stripped: CvAnalysisResponse = { ...baseAnalysis, name: "   " };
    const out = mergeAnalysisIntoState(prior, stripped, "cv.pdf");
    expect(out.profile?.name).toBe("Existing Name");
  });

  test("preserves top-level state keys not under profile (applications, sync_completed)", () => {
    const prior: CareerBuddyState = {
      profile: {},
      applications: [{ id: "abc", company: "X" }],
      sync_completed: true,
    };
    const out = mergeAnalysisIntoState(prior, baseAnalysis, "cv.pdf");
    expect(out.applications).toEqual([{ id: "abc", company: "X" }]);
    expect(out.sync_completed).toBe(true);
  });

  test("fit_score=null when analysis fit_score not numeric", () => {
    const stripped: CvAnalysisResponse = { ...baseAnalysis, fit_score: undefined };
    const out = mergeAnalysisIntoState({}, stripped, "cv.pdf");
    expect(out.profile?.cv_fit_score).toBeNull();
  });

  test("end-to-end: load → merge → save round-trip", () => {
    const initial: CareerBuddyState = {
      profile: { target_role: "BizOps", strengths: ["already-here"] },
    };
    saveCareerBuddyState(initial);

    const loaded = loadCareerBuddyState();
    const merged = mergeAnalysisIntoState(loaded, baseAnalysis, "cv.pdf");
    saveCareerBuddyState(merged);

    const reloaded = loadCareerBuddyState();
    expect(reloaded.profile?.target_role).toBe("BizOps");
    expect(reloaded.profile?.cv_analyzed).toBe(true);
    expect(reloaded.profile?.name).toBe("Troels Enigk");
    expect(reloaded.profile?.strengths).toEqual(["B2B sales", "German native"]);
  });
});
