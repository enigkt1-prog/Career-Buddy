import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockMaybeSingle = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const limitMaybeSingle = () => ({
    limit: () => ({ maybeSingle: () => mockMaybeSingle() }),
  });
  return {
    supabase: {
      auth: { getUser: () => mockGetUser() },
      from: () => ({
        upsert: (...args: unknown[]) => mockUpsert(...args),
        select: () => ({
          is: () => limitMaybeSingle(),
          eq: () => limitMaybeSingle(),
        }),
      }),
    },
  };
});

import {
  TRACKS_KEY,
  YEARS_BUCKET_KEY,
  YEARS_BUCKET_RANGES,
  fetchPersistedProfile,
  initProfileFromSupabase,
  loadSelectedTracks,
  loadYearsBucket,
  migrateLocalStorageToSupabase,
  setProfileFromAnalysis,
  setSelectedTracks,
  setYearsBucket,
  type YearsBucketId,
} from "./profile-store";
import {
  STORAGE_KEY,
  loadCareerBuddyState,
  type CvAnalysisResponse,
} from "./cv-storage";

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

// ---------------------------------------------------------------------------
// Supabase dual-write — setProfileFromAnalysis + initProfileFromSupabase
// ---------------------------------------------------------------------------

const sampleAnalysis: CvAnalysisResponse = {
  summary: "Strong B2B sales background.",
  fit_score: 7.5,
  strengths: ["B2B sales", "German native"],
  gaps: ["No SaaS PM experience"],
  recommendations: ["Apply to BizOps + Strategy"],
  target_role_categories: ["bizops", "strategy"],
  location_preferences: ["Berlin"],
  name: "Sample Candidate",
  headline: "Strategy graduate, ex-BDR",
  skills: [
    { name: "Python", level: "advanced", years: 4 },
    { name: "SQL", level: "expert", years: 6 },
  ],
};

describe("setProfileFromAnalysis", () => {
  beforeEach(() => {
    mockUpsert.mockClear().mockResolvedValue({ data: null, error: null });
    mockMaybeSingle.mockReset();
    // Default: signed-in (most realistic post-migration state).
    mockGetUser
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "u-signed-in" } }, error: null });
  });

  test("merges analysis into localStorage and stamps updated_at", async () => {
    await setProfileFromAnalysis(sampleAnalysis, "cv.pdf");
    const state = loadCareerBuddyState();
    expect(state.profile?.cv_analyzed).toBe(true);
    expect(state.profile?.cv_filename).toBe("cv.pdf");
    expect(state.profile?.skills).toEqual(sampleAnalysis.skills);
    expect(typeof state.profile?.updated_at).toBe("string");
  });

  test("signed-in: upserts the row with user_id = auth.uid()", async () => {
    await setProfileFromAnalysis(sampleAnalysis, "cv.pdf");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [row, opts] = mockUpsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "user_id", ignoreDuplicates: false });
    expect(row.user_id).toBe("u-signed-in");
    expect(row.name).toBe("Sample Candidate");
    expect(row.headline).toBe("Strategy graduate, ex-BDR");
    expect(row.skills).toEqual(sampleAnalysis.skills);
    expect(row.target_role_categories).toEqual(["bizops", "strategy"]);
    expect(row.location_preferences).toEqual(["Berlin"]);
    expect(typeof row.updated_at).toBe("string");
  });

  test("anonymous: skips Supabase upsert, localStorage still written", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await setProfileFromAnalysis(sampleAnalysis, "cv.pdf");
    expect(mockUpsert).not.toHaveBeenCalled();
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Sample Candidate");
  });

  test("Supabase failure does not throw; localStorage still saved", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("network down"));
    await expect(
      setProfileFromAnalysis(sampleAnalysis, "cv.pdf"),
    ).resolves.toBeUndefined();
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Sample Candidate");
  });
});

describe("fetchPersistedProfile", () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockMaybeSingle.mockReset();
    mockGetUser
      .mockReset()
      .mockResolvedValue({ data: { user: null }, error: null });
  });

  test("returns row data on success", async () => {
    const row = { user_id: null, name: "X", updated_at: "2026-05-10T12:00:00Z" };
    mockMaybeSingle.mockResolvedValueOnce({ data: row, error: null });
    const out = await fetchPersistedProfile();
    expect(out).toEqual(row);
  });

  test("returns null when no row exists", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchPersistedProfile()).toBeNull();
  });

  test("returns null on error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "table missing" },
    });
    expect(await fetchPersistedProfile()).toBeNull();
  });

  test("returns null when query throws", async () => {
    mockMaybeSingle.mockRejectedValueOnce(new Error("network"));
    expect(await fetchPersistedProfile()).toBeNull();
  });
});

describe("initProfileFromSupabase", () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockMaybeSingle.mockReset();
    mockGetUser
      .mockReset()
      .mockResolvedValue({ data: { user: null }, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("no-op when no Supabase row", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await initProfileFromSupabase();
    expect(loadCareerBuddyState()).toEqual({});
  });

  test("merges remote row into local state when local has no timestamp", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        user_id: null,
        name: "Remote Name",
        headline: "Remote Headline",
        skills: [{ name: "Rust", level: "intermediate" }],
        work_history: [{ company: "X", role: "Y" }],
        education: [],
        target_role: "FA",
        target_geo: "Berlin",
        target_role_categories: ["bizops"],
        location_preferences: ["Berlin"],
        cv_filename: "cv.pdf",
        cv_summary: "Summary",
        cv_fit_score: 8,
        updated_at: "2026-05-10T12:00:00Z",
      },
      error: null,
    });
    await initProfileFromSupabase();
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Remote Name");
    expect(state.profile?.headline).toBe("Remote Headline");
    expect(state.profile?.skills).toEqual([{ name: "Rust", level: "intermediate" }]);
    expect(state.profile?.target_role_categories).toEqual(["bizops"]);
    expect(state.profile?.cv_fit_score).toBe(8);
    expect(state.profile?.updated_at).toBe("2026-05-10T12:00:00Z");
  });

  test("local wins when local updated_at >= remote updated_at", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: {
          name: "Local Name",
          updated_at: "2026-05-11T00:00:00Z",
        },
      }),
    );
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        user_id: null,
        name: "Remote Name",
        skills: [],
        work_history: [],
        education: [],
        target_role_categories: [],
        location_preferences: [],
        updated_at: "2026-05-10T00:00:00Z",
      },
      error: null,
    });
    await initProfileFromSupabase();
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Local Name");
  });

  test("empty remote fields do not overwrite filled local fields", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: {
          name: "Local Name",
          skills: [{ name: "kept" }],
        },
      }),
    );
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        user_id: null,
        name: "",
        skills: [],
        work_history: [],
        education: [],
        target_role_categories: [],
        location_preferences: [],
        updated_at: "2026-05-10T00:00:00Z",
      },
      error: null,
    });
    await initProfileFromSupabase();
    const state = loadCareerBuddyState();
    expect(state.profile?.name).toBe("Local Name");
    expect(state.profile?.skills).toEqual([{ name: "kept" }]);
  });
});

// ---------------------------------------------------------------------------
// migrateLocalStorageToSupabase
// ---------------------------------------------------------------------------

describe("migrateLocalStorageToSupabase", () => {
  beforeEach(() => {
    mockUpsert.mockClear().mockResolvedValue({ data: null, error: null });
    mockGetUser
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "u-test" } }, error: null });
  });

  test("no-op when anonymous", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const ran = await migrateLocalStorageToSupabase();
    expect(ran).toEqual([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("upserts profile + tracks when localStorage has both", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile: { cv_analyzed: true, name: "Local", skills: [{ name: "Py" }] },
      }),
    );
    localStorage.setItem(
      "career-buddy-tracks-v1",
      JSON.stringify(["bizops", "strategy"]),
    );
    localStorage.setItem("career-buddy-years-bucket-v1", "3to5");

    const ran = await migrateLocalStorageToSupabase();
    expect(ran).toContain("profile");
    expect(ran).toContain("tracks");
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    // Verify both calls scoped to user_id = "u-test".
    for (const call of mockUpsert.mock.calls) {
      expect(call[0].user_id).toBe("u-test");
    }
  });

  test("skips classes already flagged migrated", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { cv_analyzed: true, name: "Local" } }),
    );
    localStorage.setItem("career-buddy-migrated-u-test-profile", "1");
    localStorage.setItem("career-buddy-migrated-u-test-tracks", "1");
    const ran = await migrateLocalStorageToSupabase();
    expect(ran).toEqual([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("marks class migrated even when nothing to migrate", async () => {
    // No profile, no tracks → both classes marked done (no work).
    const ran = await migrateLocalStorageToSupabase();
    expect(ran).toEqual([]);
    expect(localStorage.getItem("career-buddy-migrated-u-test-profile")).toBe("1");
    expect(localStorage.getItem("career-buddy-migrated-u-test-tracks")).toBe("1");
  });

  test("multi-tab lock — second call within 30s no-ops", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { cv_analyzed: true, name: "Local" } }),
    );
    const first = await migrateLocalStorageToSupabase();
    expect(first).toContain("profile");
    mockUpsert.mockClear();
    // Reset the per-class flag so the second call would try again.
    localStorage.removeItem("career-buddy-migrated-u-test-profile");
    // Lock key is still hot — second call short-circuits.
    const second = await migrateLocalStorageToSupabase();
    expect(second).toEqual([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("upsert failure leaves flag unset → retried next time", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profile: { cv_analyzed: true, name: "Local" } }),
    );
    mockUpsert.mockResolvedValueOnce({
      data: null,
      error: { message: "network down" },
    });
    const ran = await migrateLocalStorageToSupabase();
    expect(ran).not.toContain("profile");
    expect(
      localStorage.getItem("career-buddy-migrated-u-test-profile"),
    ).toBeNull();
  });
});
