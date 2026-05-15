import { describe, expect, test } from "vitest";

import {
  applicationToRow,
  cleanSnippet,
  profileCompleteness,
  profileSignature,
  safeIsoDate,
  type ApplicationRowSource,
  type CompletenessProfile,
  type SignatureProfile,
} from "./jobs-helpers";

// ---------------------------------------------------------------------------
// cleanSnippet
// ---------------------------------------------------------------------------

describe("cleanSnippet", () => {
  test("null → empty", () => {
    expect(cleanSnippet(null)).toBe("");
  });

  test("collapses runs of whitespace into single space", () => {
    expect(cleanSnippet("a   b\n\nc\td")).toBe("a b c d");
  });

  test("trims leading + trailing whitespace", () => {
    expect(cleanSnippet("  hello  ")).toBe("hello");
  });

  test("caps at 300 chars", () => {
    const long = "x".repeat(500);
    expect(cleanSnippet(long).length).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// safeIsoDate
// ---------------------------------------------------------------------------

describe("safeIsoDate", () => {
  test("undefined → null", () => {
    expect(safeIsoDate(undefined)).toBeNull();
  });

  test("empty string → null", () => {
    expect(safeIsoDate("")).toBeNull();
  });

  test("YYYY-MM-DD → full ISO", () => {
    const out = safeIsoDate("2026-05-10");
    expect(out).toMatch(/^2026-05-10T/);
  });

  test("garbage prefix → null", () => {
    expect(safeIsoDate("not-a-date")).toBeNull();
    expect(safeIsoDate("05-10-2026")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// profileCompleteness
// ---------------------------------------------------------------------------

function emptyProfile(): CompletenessProfile {
  return {
    name: "",
    headline: "",
    target_role: "",
    target_geo: "",
    background: "",
    strengths: [],
    target_role_categories: [],
    location_preferences: [],
    cv_analyzed: false,
    work_history: [],
    education: [],
  };
}

describe("profileCompleteness", () => {
  test("empty profile → score 0", () => {
    const out = profileCompleteness(emptyProfile());
    expect(out.score).toBe(0);
    expect(out.done).toBe(0);
    expect(out.total).toBe(11);
  });

  test("fully populated → 100", () => {
    const out = profileCompleteness({
      name: "Alex Candidate",
      headline: "MBA",
      target_role: "Founders Associate",
      target_geo: "Berlin",
      background: "B2B sales",
      strengths: ["sales"],
      target_role_categories: ["bizops"],
      location_preferences: ["Berlin"],
      cv_analyzed: true,
      work_history: [{}],
      education: [{}],
    });
    expect(out.score).toBe(100);
    expect(out.done).toBe(11);
  });

  test("whitespace-only string fields don't count", () => {
    const p = emptyProfile();
    p.name = "   ";
    expect(profileCompleteness(p).done).toBe(0);
  });

  test("partial → rounded percent", () => {
    const p = emptyProfile();
    p.name = "X";
    p.headline = "Y";
    const out = profileCompleteness(p);
    expect(out.done).toBe(2);
    expect(out.score).toBe(Math.round((2 / 11) * 100));
  });
});

// ---------------------------------------------------------------------------
// applicationToRow
// ---------------------------------------------------------------------------

function makeApp(overrides: Partial<ApplicationRowSource> = {}): ApplicationRowSource {
  return {
    id: "uuid-abc",
    company: "Acme",
    role: "Founders Associate",
    status: "applied",
    last_event: "2026-05-09",
    next_action: "Wait for reply",
    fit: 8.2,
    url: "https://example.com",
    notes: "Strong fit",
    ...overrides,
  };
}

describe("applicationToRow", () => {
  const UID = "user-uid-xyz";

  test("maps every field to its snake_case Supabase column + sets user_id", () => {
    const out = applicationToRow(makeApp(), UID);
    expect(out).toEqual({
      user_id: UID,
      client_id: "uuid-abc",
      company: "Acme",
      role: "Founders Associate",
      status: "applied",
      next_action: "Wait for reply",
      fit_score: 8.2,
      url: "https://example.com",
      notes: "Strong fit",
      last_event_date: expect.stringMatching(/^2026-05-09T/),
    });
  });

  test("undefined url + notes → null", () => {
    const out = applicationToRow(
      makeApp({ url: undefined, notes: undefined }),
      UID,
    );
    expect(out.url).toBeNull();
    expect(out.notes).toBeNull();
  });

  test("empty last_event → null", () => {
    const out = applicationToRow(makeApp({ last_event: "" }), UID);
    expect(out.last_event_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// profileSignature
// ---------------------------------------------------------------------------

function makeSigProfile(overrides: Partial<SignatureProfile> = {}): SignatureProfile {
  return {
    target_role: "Founders Associate",
    target_geo: "Berlin",
    background: "B2B sales",
    headline: "MBA",
    strengths: ["sales", "german"],
    target_role_categories: ["bizops"],
    location_preferences: ["Berlin"],
    work_history: [{ company: "Acme", role: "BDR", bullets: ["Closed 14"] }],
    ...overrides,
  };
}

describe("profileSignature", () => {
  test("returns hex string", () => {
    expect(profileSignature(makeSigProfile())).toMatch(/^[0-9a-f]+$/);
  });

  test("identical inputs → identical signature", () => {
    expect(profileSignature(makeSigProfile())).toBe(profileSignature(makeSigProfile()));
  });

  test("changing target_role changes signature", () => {
    const a = profileSignature(makeSigProfile());
    const b = profileSignature(makeSigProfile({ target_role: "BizOps" }));
    expect(a).not.toBe(b);
  });

  test("strengths order doesn't change signature (sort-stable)", () => {
    const a = profileSignature(makeSigProfile({ strengths: ["a", "b"] }));
    const b = profileSignature(makeSigProfile({ strengths: ["b", "a"] }));
    expect(a).toBe(b);
  });

  test("target_role_categories order doesn't change signature", () => {
    const a = profileSignature(makeSigProfile({ target_role_categories: ["x", "y"] }));
    const b = profileSignature(makeSigProfile({ target_role_categories: ["y", "x"] }));
    expect(a).toBe(b);
  });

  test("location_preferences order doesn't change signature", () => {
    const a = profileSignature(makeSigProfile({ location_preferences: ["Berlin", "Munich"] }));
    const b = profileSignature(makeSigProfile({ location_preferences: ["Munich", "Berlin"] }));
    expect(a).toBe(b);
  });

  test("work_history bullet change DOES change signature", () => {
    const a = profileSignature(makeSigProfile());
    const b = profileSignature(
      makeSigProfile({
        work_history: [{ company: "Acme", role: "BDR", bullets: ["Closed 20"] }],
      }),
    );
    expect(a).not.toBe(b);
  });
});
