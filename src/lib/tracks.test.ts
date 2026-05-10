import { describe, expect, test } from "vitest";

import { TRACKS, getTrack, isInExperienceWindow, type Track, type TrackId } from "./tracks";

describe("TRACKS catalogue", () => {
  test("has 18 entries (operator + sector + function)", () => {
    expect(TRACKS).toHaveLength(18);
  });

  test("every track has unique id", () => {
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every track has non-empty label and hint", () => {
    for (const t of TRACKS) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.hint.trim().length).toBeGreaterThan(0);
    }
  });

  test("every track has integer experienceMin >= 0", () => {
    for (const t of TRACKS) {
      expect(Number.isInteger(t.experienceMin)).toBe(true);
      expect(t.experienceMin).toBeGreaterThanOrEqual(0);
    }
  });

  test("when experienceMax present it is integer >= experienceMin", () => {
    for (const t of TRACKS) {
      if (t.experienceMax !== undefined) {
        expect(Number.isInteger(t.experienceMax)).toBe(true);
        expect(t.experienceMax).toBeGreaterThanOrEqual(t.experienceMin);
      }
    }
  });

  test("operator-track wedge ids cover the FA-relevant categories", () => {
    const ids = new Set(TRACKS.map((t) => t.id));
    for (const fa of [
      "founders-associate",
      "bizops",
      "strategy",
      "chief-of-staff",
      "investment-analyst",
      "bd",
    ] as const) {
      expect(ids.has(fa)).toBe(true);
    }
  });
});

describe("getTrack", () => {
  test("returns track for known id", () => {
    const t = getTrack("chief-of-staff");
    expect(t).toBeDefined();
    expect(t?.label).toMatch(/Chief of Staff/);
  });

  test("returns undefined for unknown id", () => {
    expect(getTrack("not-a-real-track")).toBeUndefined();
  });
});

describe("isInExperienceWindow", () => {
  const cos = getTrack("chief-of-staff") as Track;
  const founders = getTrack("founders-associate") as Track;

  test("FA 0-3 years window: 2 fits, 5 does not", () => {
    expect(isInExperienceWindow(founders, 2)).toBe(true);
    expect(isInExperienceWindow(founders, 5)).toBe(false);
  });

  test("CoS 5+ years (open-ended): 5 fits, 20 fits, 3 does not", () => {
    expect(isInExperienceWindow(cos, 5)).toBe(true);
    expect(isInExperienceWindow(cos, 20)).toBe(true);
    expect(isInExperienceWindow(cos, 3)).toBe(false);
  });

  test("boundary inclusive — min and max both fit", () => {
    expect(isInExperienceWindow(founders, 0)).toBe(true);
    expect(isInExperienceWindow(founders, 3)).toBe(true);
  });
});

describe("TrackId type usage (compile-time)", () => {
  test("type narrows from getTrack", () => {
    const t = getTrack("bizops");
    if (t) {
      const id: TrackId = t.id;
      expect(id).toBe("bizops");
    }
  });
});
