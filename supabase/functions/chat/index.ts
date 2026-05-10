// Career-Buddy chat edge function. Plain conversational endpoint backed by
// Gemini 2.5-flash. Stateless: client passes the full message history per call.
// Quota-aware: 429 surfaces cleanly so the client can fall back to canned tips.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { authenticate, unauthorisedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are Career-Buddy, a coach for one user (a business-background graduate hunting their first non-engineering startup role).

You have the user's profile, recent applications, and (optionally) a single job posting picked from their feed. Use ONLY the supplied context — do not invent facts.

Rules:
- Be direct, concrete, and short. Prefer ranked lists and one-line takeaways.
- When the user asks "what should I do today?", point to specific roles + applications by name.
- When asked about a job they're not yet applied to, weigh fit (role-cat, location, years, skills) and tell them whether to apply, what to mention, and what blockers to address.
- When asked to draft, keep ≤150 words.
- Match the language of the user's last message (German or English).
- If you cannot answer with the supplied context, say so.`;

type Profile = Record<string, unknown> | undefined;
type Application = Record<string, unknown>;
type JobInput = Record<string, unknown> | undefined;

function summariseProfile(p: Profile): string {
  if (!p) return "(no profile yet)";
  const fields: Array<[string, unknown]> = [
    ["name", p.name],
    ["headline", p.headline],
    ["target role", p.target_role],
    ["target geo", p.target_geo],
    ["background", p.background],
    ["strengths", Array.isArray(p.strengths) ? (p.strengths as string[]).slice(0, 6).join(", ") : null],
    ["gaps", Array.isArray(p.gaps) ? (p.gaps as string[]).slice(0, 4).join(", ") : null],
  ];
  const out = fields
    .filter(([, v]) => v && (typeof v !== "string" || v.length > 0))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  // Add up to 3 most recent positions.
  const wh = Array.isArray(p.work_history) ? (p.work_history as Array<Record<string, unknown>>) : [];
  const positions = wh
    .slice(0, 3)
    .map((w) => `- ${w.role ?? ""} @ ${w.company ?? ""} (${w.start_date ?? ""}-${w.end_date ?? ""})`)
    .join("\n");
  return positions ? `${out}\nrecent positions:\n${positions}` : out;
}

function summariseApps(apps: Application[]): string {
  if (!apps || apps.length === 0) return "(no applications yet)";
  return apps
    .slice(0, 12)
    .map((a) => `- ${a.company} · ${a.role} · ${a.status} · last_event=${a.last_event ?? "?"}`)
    .join("\n");
}

function summariseJob(j: JobInput): string {
  if (!j) return "";
  return [
    `Company: ${j.company ?? ""}`,
    `Role: ${j.role ?? ""}`,
    `Location: ${j.location ?? ""}`,
    `Description: ${String(j.description ?? "").slice(0, 4000)}`,
    j.requirements ? `Requirements: ${String(j.requirements).slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type ChatTurn = { role: "user" | "assistant"; content: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const authResult = await authenticate(req);
  if (!authResult.ok) {
    return unauthorisedResponse(authResult, corsHeaders);
  }
  try {
    const body = await req.json();
    const messages = (Array.isArray(body?.messages) ? body.messages : []) as ChatTurn[];
    if (messages.length === 0) {
      return jsonResponse({ error: "messages[] required" }, 400);
    }
    const profile = body?.profile as Profile;
    const applications = (Array.isArray(body?.applications) ? body.applications : []) as Application[];
    const job = body?.job as JobInput;

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY not configured on server" }, 500);
    }

    const contextBlock = [
      "## CANDIDATE PROFILE",
      summariseProfile(profile),
      "",
      "## RECENT APPLICATIONS",
      summariseApps(applications),
      job ? "\n## JOB IN FOCUS\n<jd>\n" + summariseJob(job) + "\n</jd>" : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Gemini chat-style: turn array becomes contents[]. Last user message includes
    // the context block prepended so the model has it without us cluttering history.
    const history = messages.slice(0, -1);
    const last = messages[messages.length - 1];
    const lastWithContext: ChatTurn = {
      role: last.role,
      content: `${contextBlock}\n\n## USER MESSAGE\n${last.content}`,
    };

    const contents = [...history, lastWithContext].map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const reqBody = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.4 },
    };

    let resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    if (resp.status >= 500 && resp.status < 600) {
      await new Promise((r) => setTimeout(r, 500));
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Gemini chat error", resp.status, text.slice(0, 400));
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
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply || typeof reply !== "string") {
      return jsonResponse({ error: "Gemini returned empty reply" }, 502);
    }
    return jsonResponse({ reply: reply.trim() });
  } catch (e) {
    console.error("chat error:", e);
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
