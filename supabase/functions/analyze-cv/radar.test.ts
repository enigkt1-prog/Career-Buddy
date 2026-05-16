// Deno tests for the analyze-cv radar concern.
// Run: deno test supabase/functions/analyze-cv/radar.test.ts
//
// Covers the Zod validator (reject malformed / accept valid) and the
// target-profile-aware axis selection.

import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  RADAR_AXES_COMMERCIAL,
  RADAR_AXES_TECHNICAL,
  selectRadarAxes,
  validateRadar,
} from "./radar.ts";

function validPayload(axes: readonly string[]) {
  return {
    axes: axes.map((name, i) => ({ name, score: 40 + i * 5 })),
    strengths: ["Closed three enterprise deals"],
    weaknesses: ["No P&L ownership yet"],
    gaps: ["Lead a cross-functional launch"],
  };
}

Deno.test("validateRadar accepts a well-formed commercial payload", () => {
  const radar = validateRadar(validPayload(RADAR_AXES_COMMERCIAL), RADAR_AXES_COMMERCIAL);
  assertEquals(radar.axes.length, 6);
  assertEquals(radar.strengths.length, 1);
});

Deno.test("validateRadar rejects an unknown axis name", () => {
  const bad = validPayload(RADAR_AXES_COMMERCIAL);
  bad.axes[0].name = "Vibes";
  assertThrows(() => validateRadar(bad, RADAR_AXES_COMMERCIAL));
});

Deno.test("validateRadar rejects an out-of-range score", () => {
  const bad = validPayload(RADAR_AXES_COMMERCIAL);
  bad.axes[1].score = 140;
  assertThrows(() => validateRadar(bad, RADAR_AXES_COMMERCIAL));
});

Deno.test("validateRadar rejects a missing axis", () => {
  const bad = validPayload(RADAR_AXES_COMMERCIAL);
  bad.axes = bad.axes.slice(0, 5);
  assertThrows(() => validateRadar(bad, RADAR_AXES_COMMERCIAL));
});

Deno.test("validateRadar rejects an empty insight array", () => {
  const bad = validPayload(RADAR_AXES_COMMERCIAL);
  bad.strengths = [];
  assertThrows(() => validateRadar(bad, RADAR_AXES_COMMERCIAL));
});

Deno.test("validateRadar rejects undefined", () => {
  assertThrows(() => validateRadar(undefined, RADAR_AXES_COMMERCIAL));
});

Deno.test("selectRadarAxes returns technical axes for engineering roles", () => {
  assertEquals(selectRadarAxes(["engineering"]), RADAR_AXES_TECHNICAL);
  assertEquals(selectRadarAxes(["data"]), RADAR_AXES_TECHNICAL);
  assertEquals(selectRadarAxes(["design"]), RADAR_AXES_TECHNICAL);
});

Deno.test("selectRadarAxes defaults to commercial axes", () => {
  assertEquals(selectRadarAxes(["bizops", "strategy"]), RADAR_AXES_COMMERCIAL);
  assertEquals(selectRadarAxes([]), RADAR_AXES_COMMERCIAL);
});
