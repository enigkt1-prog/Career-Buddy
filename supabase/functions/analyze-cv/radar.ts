// CV radar concern for the analyze-cv edge function.
//
// Keeps index.ts lean: the 6-axis spider-chart scoring lives here —
// the pinned axis sets, the prompt fragment, the Zod validator that
// rejects a malformed LLM payload, and the append-only snapshot
// INSERT into `user_radar_snapshots` (migration 0021).

import { z } from "https://esm.sh/zod@3.23.8";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Pinned axis sets — target-profile-aware. The LLM never invents axis
// names; it scores exactly the set we hand it. Validator rejects any
// drift.

// Default (technical roles): SWE, data, DevOps, ML, design-eng.
export const RADAR_AXES_TECHNICAL = [
  "Technical depth",
  "Leadership",
  "Domain expertise",
  "Communication",
  "Execution",
  "Growth trajectory",
] as const;

// Non-technical (sales, BD, ops, product, marketing, exec).
export const RADAR_AXES_COMMERCIAL = [
  "Commercial acumen",
  "Leadership",
  "Domain expertise",
  "Communication",
  "Execution",
  "Growth trajectory",
] as const;

// Role categories that flip the axis set to the technical variant.
// Ids match the canonical TRACKS list (src/lib/tracks.ts) — the data
// track id is "data", not "data-science".
const TECHNICAL_CATEGORIES = new Set(["engineering", "data", "design"]);

export type RadarAxis = { name: string; score: number };
export type Radar = {
  axes: RadarAxis[];
  strengths: string[];
  weaknesses: string[];
  gaps: string[];
};

/**
 * Select the pinned axis set. Technical axes when the target role
 * categories overlap engineering / data-science / design; commercial
 * axes otherwise (the Career-Buddy default — business-grad roles).
 */
export function selectRadarAxes(
  targetRoleCategories: string[],
): readonly string[] {
  const technical = targetRoleCategories.some((c) => TECHNICAL_CATEGORIES.has(c));
  return technical ? RADAR_AXES_TECHNICAL : RADAR_AXES_COMMERCIAL;
}

/**
 * Gemini `responseSchema` fragment for the `radar` object. Axis names
 * are not enumerated here (the schema is static); the prompt pins them
 * and {@link validateRadar} enforces the exact set.
 */
export const RADAR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    axes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number", description: "0-100 score on this axis." },
        },
        required: ["name", "score"],
      },
      description: "One entry per pinned axis, scored 0-100.",
    },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "2-4 radar strengths — high-scoring axes with the CV evidence.",
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
      description: "2-4 radar weaknesses — low-scoring axes named plainly.",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "2-4 concrete missing experiences that would lift the weak axes.",
    },
  },
  required: ["axes", "strengths", "weaknesses", "gaps"],
};

/**
 * Prompt fragment instructing the LLM to score the pinned axes. The
 * axis names must be reproduced verbatim under the `radar` key.
 */
export function buildRadarPromptSection(axes: readonly string[]): string {
  return `RADAR:
Score the candidate 0-100 on EACH of these exact axes (reproduce the axis names verbatim):
${axes.map((a) => `- ${a}`).join("\n")}
Then, under the "radar" key, return:
- axes: one {name, score} entry per axis above, score 0-100
- strengths: 2-4 high-scoring axes with the concrete CV evidence
- weaknesses: 2-4 low-scoring axes named plainly
- gaps: 2-4 concrete missing experiences that would lift the weak axes`;
}

function makeRadarSchema(axes: readonly string[]) {
  const axisName = z.enum([...axes] as [string, ...string[]]);
  const nonEmptyStrings = z.array(z.string().trim().min(1)).min(1);
  return z
    .object({
      axes: z
        .array(
          z.object({
            name: axisName,
            score: z.number().min(0).max(100),
          }),
        )
        .length(axes.length),
      strengths: nonEmptyStrings,
      weaknesses: nonEmptyStrings,
      gaps: nonEmptyStrings,
    })
    .refine(
      (r) => new Set(r.axes.map((a) => a.name)).size === axes.length,
      { message: "radar.axes must cover each pinned axis exactly once" },
    );
}

/**
 * Validate the LLM `radar` payload against the pinned axis set.
 * Throws (Zod error) on any drift — wrong / missing / duplicate axis,
 * out-of-range score, or an empty strengths / weaknesses / gaps array.
 */
export function validateRadar(raw: unknown, axes: readonly string[]): Radar {
  return makeRadarSchema(axes).parse(raw) as Radar;
}

/**
 * Append a radar snapshot to `user_radar_snapshots` under the caller's
 * JWT (RLS enforces `auth.uid() = user_id`). Returns the new row id,
 * or null when anonymous / env missing / the insert fails — the CV
 * analysis still succeeds without a persisted snapshot id.
 */
export async function insertRadarSnapshot(
  req: Request,
  userId: string,
  radar: Radar,
  filename: string | null,
): Promise<string | null> {
  if (userId === "anonymous") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;
  try {
    const client = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client
      .from("user_radar_snapshots")
      .insert({
        user_id: userId,
        source_cv_filename: filename,
        axes: radar.axes,
        strengths: radar.strengths,
        weaknesses: radar.weaknesses,
        gaps: radar.gaps,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("radar snapshot insert failed", error?.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.error("radar snapshot insert threw", e);
    return null;
  }
}
