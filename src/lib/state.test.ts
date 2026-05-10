import { describe, expect, test } from "vitest";

import { STORAGE_KEY } from "./cv-storage";
import { emptyState, loadState, migrateProfile } from "./state";
import { DEFAULT_PROFILE } from "./types";

describe("emptyState", () => {
  test("applications [] + profile = DEFAULT_PROFILE clone", () => {
    const s = emptyState();
    expect(s.applications).toEqual([]);
    expect(s.profile).toEqual(DEFAULT_PROFILE);
    expect(s.profile).not.toBe(DEFAULT_PROFILE); // cloned
    expect(s.sync_completed).toBe(false);
    expect(s.dismissed_urls).toEqual([]);
  });
});

describe("migrateProfile", () => {
  test("non-object → DEFAULT_PROFILE", () => {
    expect(migrateProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(migrateProfile(undefined)).toEqual(DEFAULT_PROFILE);
    expect(migrateProfile("string")).toEqual(DEFAULT_PROFILE);
    expect(migrateProfile(42)).toEqual(DEFAULT_PROFILE);
  });

  test("empty object → DEFAULT_PROFILE", () => {
    expect(migrateProfile({})).toEqual(DEFAULT_PROFILE);
  });

  test("preserves typed string fields", () => {
    const out = migrateProfile({
      name: "Troels",
      target_role: "Founders Associate",
      headline: "MBA",
    });
    expect(out.name).toBe("Troels");
    expect(out.target_role).toBe("Founders Associate");
    expect(out.headline).toBe("MBA");
  });

  test("falls back to DEFAULT_PROFILE for wrong-type strings", () => {
    const out = migrateProfile({ name: 42, target_role: null });
    expect(out.name).toBe("");
    expect(out.target_role).toBe(DEFAULT_PROFILE.target_role);
  });

  test("flips boolean fields strict-equality", () => {
    const out = migrateProfile({ built: true, cv_analyzed: "yes", collapsed: 1 });
    expect(out.built).toBe(true);
    expect(out.cv_analyzed).toBe(false);
    expect(out.collapsed).toBe(false);
  });

  test("array fields filter to strings", () => {
    const out = migrateProfile({
      strengths: ["sales", 42, null, "german"],
      gaps: ["x"],
    });
    expect(out.strengths).toEqual(["sales", "german"]);
    expect(out.gaps).toEqual(["x"]);
  });

  test("non-array array-fields fall back to DEFAULT", () => {
    const out = migrateProfile({ strengths: "not-array" });
    expect(out.strengths).toEqual(DEFAULT_PROFILE.strengths);
  });

  test("work_history + education get generated ids when missing", () => {
    const out = migrateProfile({
      work_history: [
        { company: "Acme", role: "BDR", start_date: "2024-01", end_date: "2025-01", bullets: [] },
      ],
      education: [{ institution: "Uni", degree: "MBA" }],
    });
    expect(out.work_history).toHaveLength(1);
    expect(out.work_history[0].id).toBeTruthy();
    expect(out.education).toHaveLength(1);
    expect(out.education[0].id).toBeTruthy();
  });

  test("preserves existing ids on work_history + education", () => {
    const out = migrateProfile({
      work_history: [
        { id: "w-keep", company: "X", role: "Y", start_date: "", end_date: "", bullets: [] },
      ],
      education: [{ id: "e-keep", institution: "X", degree: "Y" }],
    });
    expect(out.work_history[0].id).toBe("w-keep");
    expect(out.education[0].id).toBe("e-keep");
  });

  test("cv_fit_score numeric coerce + fallback null", () => {
    expect(migrateProfile({ cv_fit_score: 7.5 }).cv_fit_score).toBe(7.5);
    expect(migrateProfile({ cv_fit_score: "7.5" }).cv_fit_score).toBeNull();
    expect(migrateProfile({}).cv_fit_score).toBeNull();
  });
});

describe("loadState", () => {
  test("empty storage → emptyState()", () => {
    expect(loadState()).toEqual(emptyState());
  });

  test("corrupted JSON → emptyState()", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadState()).toEqual(emptyState());
  });

  test("returns persisted state with migrated profile", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        applications: [
          {
            id: "a1",
            company: "X",
            role: "Y",
            status: "applied",
            last_event: "",
            next_action: "",
            fit: 7,
          },
        ],
        profile: { name: "Troels", built: true },
        sync_completed: true,
        dismissed_urls: ["http://example.com/job/1"],
      }),
    );
    const out = loadState();
    expect(out.applications).toHaveLength(1);
    expect(out.applications[0].id).toBe("a1");
    expect(out.profile.name).toBe("Troels");
    expect(out.profile.built).toBe(true);
    expect(out.sync_completed).toBe(true);
    expect(out.dismissed_urls).toEqual(["http://example.com/job/1"]);
  });

  test("empty applications array falls back to SEED_APPS (also [])", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ applications: [], profile: { name: "X" } }),
    );
    expect(loadState().applications).toEqual([]);
  });

  test("dismissed_urls filters non-string entries", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: {},
        dismissed_urls: ["a", 42, null, "b"],
      }),
    );
    expect(loadState().dismissed_urls).toEqual(["a", "b"]);
  });
});
