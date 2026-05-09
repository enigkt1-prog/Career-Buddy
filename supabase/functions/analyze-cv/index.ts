// Career-Buddy CV analyzer.
// Calls Gemini REST API directly (gemini-2.5-flash, free tier).
// Returns structured CV analysis + work history.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One-sentence overall summary." },
    fit_score: { type: "number", description: "0-10 fit to the target profile." },
    strengths: {
      type: "array",
      items: { type: "string" },
      description: "3-5 concrete strengths phrased as bullet points.",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "3-5 concrete gaps for the target role.",
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description: "2-4 actionable next steps.",
    },
    target_role_categories: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "founders-associate",
          "bizops",
          "strategy",
          "bd",
          "chief-of-staff",
          "investment-analyst",
          "other",
        ],
      },
      description: "1-3 best-fit role categories from the enum.",
    },
    location_preferences: {
      type: "array",
      items: { type: "string" },
      description: "Locations the candidate fits or prefers (e.g. Berlin, Remote-DACH).",
    },
    name: { type: "string", description: "Candidate full name as written on the CV." },
    headline: { type: "string", description: "One-line professional headline." },
    work_history: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          role: { type: "string" },
          start_date: { type: "string", description: "YYYY-MM or YYYY." },
          end_date: { type: "string", description: "YYYY-MM, YYYY, or 'Present'." },
          location: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" },
            description: "2-5 concise achievement bullets.",
          },
        },
        required: ["company", "role", "start_date", "end_date", "bullets"],
      },
      description: "Work positions in reverse-chronological order.",
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
        required: ["institution", "degree"],
      },
    },
  },
  required: [
    "summary",
    "fit_score",
    "strengths",
    "gaps",
    "recommendations",
    "target_role_categories",
    "location_preferences",
    "work_history",
  ],
};

const SYSTEM_PROMPT = `You are a precise career advisor for business-background graduates targeting their first non-engineering startup role (Founders Associate, BizOps, Strategy, BD, Chief-of-Staff, junior VC).

Your job: extract a CV into clean structured data AND advise on fit to a target profile.

Rules:
- Match the language of the CV (German or English) for free-text fields.
- Be specific. Replace vague claims like "team player" with the concrete behavior on the CV.
- Output ONLY the JSON object matching the schema. No markdown fences, no prose.
- Preserve the candidate's exact phrasing in work-history bullets where useful.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cvText, targetProfile } = await req.json();
    if (!cvText || typeof cvText !== "string") {
      return jsonResponse({ error: "cvText required" }, 400);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY not configured on server" }, 500);
    }

    const target =
      targetProfile ||
      "Founders Associate / Operating Associate, Berlin / Remote-DACH, business-background grad (e.g. CLSBE Master), 0-2 years experience.";

    const userPrompt = `TARGET PROFILE:\n${target}\n\nCV TEXT:\n${cvText.slice(0, 24000)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Gemini error", resp.status, text.slice(0, 400));
      if (resp.status === 429) {
        return jsonResponse(
          { error: "Gemini free-tier daily quota exhausted. Try again tomorrow." },
          429,
        );
      }
      return jsonResponse(
        { error: `Gemini error ${resp.status}` },
        resp.status === 400 ? 400 : 502,
      );
    }

    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw || typeof raw !== "string") {
      console.error("Gemini empty response", JSON.stringify(data).slice(0, 400));
      return jsonResponse({ error: "Gemini returned no analysis" }, 502);
    }

    let analysis: unknown;
    try {
      analysis = JSON.parse(raw);
    } catch (parseErr) {
      console.error("Gemini JSON parse failed", parseErr, raw.slice(0, 400));
      return jsonResponse({ error: "Gemini returned invalid JSON" }, 502);
    }

    return jsonResponse({ analysis });
  } catch (e) {
    console.error("analyze-cv error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
