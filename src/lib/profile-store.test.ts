import { describe, expect, test } from "vitest";

import {
  TRACKS_KEY,
  YEARS_BUCKET_KEY,
  YEARS_BUCKET_RANGES,
  loadSelectedTracks,
  loadYearsBucket,
  setSelectedTracks,
  setYearsBucket,
  type YearsBucketId,
} from "./profile-store";
import { STORAGE_KEY, loadCareerBuddyState } from "./cv-storage";

// ---------------------------------------------------------------------------
// Tracks — dual-write + dual-read
// ---------------------------------------------------------------------------

describe("setSelectedTracks", () => {
  test("writes legacy key as JSON array", () => {
    setSelectedTracks(["bizops", "strategy"]);
    expect(localStorage.getItem(TRACKS_KEY)).toBe(JSON.stringify(["bizops", "strategy"]));
  });

  test("mirrors into career-buddy-state.profile.target_role_categories", () => {
    setSelectedTracks(["bd", "founders-associate"]);
    const state = loadCareerBuddyState();
    expect(state.profile?.target_role_categories).toEqual(["bd", "founders-associate"]);
  });

  test("preserves other profile fields when mirroring", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { name: "Alex", headline: "MBA" } }),
    );
    setSelectedTracks(["strategy"]);
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Alex");
    expect(state.profile?.headline).toBe("MBA");
    expect(state.profile?.target_role_categories).toEqual(["strategy"]);
  });

  test("preserves top-level state keys (applications, sync_completed)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        applications: [{ id: "a", company: "X" }],
        sync_completed: true,
      }),
    );
    setSelectedTracks(["bizops"]);
    const state = loadCareerBuddyState();
    expect(state.applications).toEqual([{ id: "a", company: "X" }]);
    expect(state.sync_completed).toBe(true);
  });
});

describe("loadSelectedTracks", () => {
  test("returns [] on empty storage", () => {
    expect(loadSelectedTracks()).toEqual([]);
  });

  test("prefers career-buddy-state.profile.target_role_categories when set", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { target_role_categories: ["pe", "ib"] } }),
    );
    localStorage.setItem(TRACKS_KEY, JSON.stringify(["legacy-only"]));
    expect(loadSelectedTracks()).toEqual(["pe", "ib"]);
  });

  test("falls back to legacy key when profile array is empty", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { target_role_categories: [] } }),
    );
    localStorage.setItem(TRACKS_KEY, JSON.stringify(["legacy"]));
    expect(loadSelectedTracks()).toEqual(["legacy"]);
  });

  test("falls back to legacy key when state has no profile", () => {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(["chief-of-staff"]));
    expect(loadSelectedTracks()).toEqual(["chief-of-staff"]);
  });

  test("returns [] on corrupted legacy JSON", () => {
    localStorage.setItem(TRACKS_KEY, "{not json");
    expect(loadSelectedTracks()).toEqual([]);
  });

  test("filters out non-string entries from legacy", () => {
    localStorage.setItem(TRACKS_KEY, JSON.stringify(["bizops", 42, null, "strategy"]));
    expect(loadSelectedTracks()).toEqual(["bizops", "strategy"]);
  });
});

// ---------------------------------------------------------------------------
// Years bucket — dual-write + dual-read
// ---------------------------------------------------------------------------

describe("YEARS_BUCKET_RANGES", () => {
  test("each bucket has integer years_min >= 0", () => {
    for (const r of Object.values(YEARS_BUCKET_RANGES)) {
      expect(Number.isInteger(r.years_min)).toBe(true);
      expect(r.years_min).toBeGreaterThanOrEqual(0);
    }
  });

  test("gt10 is open-ended (no years_max)", () => {
    expect(YEARS_BUCKET_RANGES.gt10.years_max).toBeUndefined();
  });
});

describe("setYearsBucket", () => {
  test("writes legacy key as raw bucket id", () => {
    setYearsBucket("3to5");
    expect(localStorage.getItem(YEARS_BUCKET_KEY)).toBe("3to5");
  });

  test("mirrors years_min + years_max into profile", () => {
    setYearsBucket("3to5");
    const state = loadCareerBuddyState();
    expect(state.profile?.years_min).toBe(3);
    expect(state.profile?.years_max).toBe(5);
  });

  test("open-ended bucket sets years_max=null", () => {
    setYearsBucket("gt10");
    const state = loadCareerBuddyState();
    expect(state.profile?.years_min).toBe(10);
    expect(state.profile?.years_max).toBeNull();
  });

  test("preserves other profile fields", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { name: "Bo", strengths: ["sales"] } }),
    );
    setYearsBucket("1to2");
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Bo");
    expect(state.profile?.strengths).toEqual(["sales"]);
    expect(state.profile?.years_min).toBe(1);
    expect(state.profile?.years_max).toBe(2);
  });
});

describe("loadYearsBucket", () => {
  test("returns null on empty storage", () => {
    expect(loadYearsBucket()).toBeNull();
  });

  test("returns bucket id from legacy key when valid", () => {
    localStorage.setItem(YEARS_BUCKET_KEY, "6to10");
    expect(loadYearsBucket()).toBe("6to10");
  });

  test("returns null when legacy key has invalid value", () => {
    localStorage.setItem(YEARS_BUCKET_KEY, "garbage");
    expect(loadYearsBucket()).toBeNull();
  });

  test("derives bucket from profile.years_min when legacy missing", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: { years_min: 4 } }));
    expect(loadYearsBucket()).toBe("3to5");
  });

  test("derives all five buckets correctly from years_min", () => {
    const cases: Array<{ years_min: number; expected: YearsBucketId }> = [
      { years_min: 0, expected: "lt1" },
      { years_min: 1, expected: "1to2" },
      { years_min: 2, expected: "1to2" },
      { years_min: 3, expected: "3to5" },
      { years_min: 5, expected: "3to5" },
      { years_min: 6, expected: "6to10" },
      { years_min: 10, expected: "gt10" },
      { years_min: 25, expected: "gt10" },
    ];
    for (const { years_min, expected } of cases) {
      localStorage.removeItem(YEARS_BUCKET_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: { years_min } }));
      expect(loadYearsBucket()).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: UI mutation → CareerBuddy reads
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  test("setSelectedTracks then loadCareerBuddyState reflects in profile", () => {
    setSelectedTracks(["bizops", "strategy", "bd"]);
    const state = loadCareerBuddyState();
    expect(state.profile?.target_role_categories).toEqual(["bizops", "strategy", "bd"]);
  });

  test("setYearsBucket → loadYearsBucket idempotent", () => {
    setYearsBucket("3to5");
    expect(loadYearsBucket()).toBe("3to5");
  });

  test("setSelectedTracks then setYearsBucket — both visible in profile", () => {
    setSelectedTracks(["chief-of-staff"]);
    setYearsBucket("gt10");
    const state = loadCareerBuddyState();
    expect(state.profile?.target_role_categories).toEqual(["chief-of-staff"]);
    expect(state.profile?.years_min).toBe(10);
  });
});
