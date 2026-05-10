import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { extractCvText } from "@/lib/cv-parser";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "career-buddy-state";

type CvAnalysisResponse = {
  summary?: string;
  fit_score?: number;
  strengths?: string[];
  gaps?: string[];
  recommendations?: string[];
  target_role_categories?: string[];
  location_preferences?: string[];
  name?: string;
  headline?: string;
  work_history?: unknown[];
  education?: unknown[];
};

/**
 * Inline CV upload card. Phase 0.5 — replaces the previous "Upload on
 * Overview" deep link that bounced the user back and forth. Uses the
 * same `extractCvText` parser + `analyze-cv` edge function as the
 * Overview's existing CV section, and writes the resulting profile
 * fields into the SAME localStorage key (`career-buddy-state`) that
 * `CareerBuddy.tsx` reads. The next time the user visits Overview
 * the analysed profile is already loaded.
 */
export function CvUploadInline() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "analysing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setSummary(null);
    setFilename(file.name);
    setPhase("reading");
    try {
      const extracted = await extractCvText(file);
      if (!extracted || extracted.length < 50) {
        setPhase("idle");
        setError(
          "Could not extract enough text from the file. Try pasting the CV text below instead.",
        );
        return;
      }
      setText(extracted);
      await analyse(extracted);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Could not read file");
    }
  }

  async function analyse(content: string) {
    if (!content.trim()) {
      setError("Paste CV text or upload a .pdf / .docx file first.");
      return;
    }
    setPhase("analysing");
    setError(null);
    try {
      // Edge function contract (verified against
      // supabase/functions/analyze-cv/index.ts:117 + :181):
      //   body  = { cvText: string, targetProfile?: string }
      //   reply = { analysis: CvAnalysisResponse } | { error: string }
      const { data, error: fnErr } = await supabase.functions.invoke("analyze-cv", {
        body: { cvText: content.slice(0, 40_000) },
      });
      if (fnErr) throw fnErr;
      const payload = (data ?? {}) as { analysis?: CvAnalysisResponse; error?: string };
      if (!payload.analysis) {
        throw new Error(payload.error ?? "analyze-cv returned no analysis");
      }
      mergeIntoLocalState(payload.analysis, filename ?? "cv.txt");
      setSummary(payload.analysis.summary ?? "Analysis complete. Open Overview to review.");
      setPhase("done");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "analyse-cv failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="pill-cta"
          disabled={phase === "reading" || phase === "analysing"}
        >
          {phase === "reading" || phase === "analysing" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {phase === "reading"
            ? "Reading file…"
            : phase === "analysing"
              ? "Analysing…"
              : "Upload .pdf / .docx / .txt"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {filename && <span className="text-cinema-caption">{filename}</span>}
      </div>

      <textarea
        rows={4}
        className="w-full border border-cinema-mint rounded-glass p-3 text-base font-mono bg-white/80 text-cinema-ink resize-y focus:outline-none focus:ring-2 focus:ring-cinema-sage"
        placeholder="…or paste CV text here, then click Analyse"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <button
          type="button"
          onClick={() => void analyse(text)}
          disabled={!text.trim() || phase === "analysing"}
          className="pill-cta-soft disabled:opacity-50"
        >
          {phase === "analysing" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {phase === "analysing" ? "Analysing…" : "Analyse pasted text"}
        </button>
      </div>

      {error && (
        <div className="text-base text-destructive bg-red-50 border border-red-200 rounded-glass px-3 py-2">
          {error}
        </div>
      )}

      {summary && (
        <div className="text-base text-cinema-ink-soft bg-cinema-mint/40 border border-cinema-mint rounded-glass px-4 py-3">
          {summary}{" "}
          <a href="/" className="underline text-cinema-pine font-medium">
            Open Overview to review →
          </a>
        </div>
      )}
    </div>
  );
}

function mergeIntoLocalState(analysis: CvAnalysisResponse, cvFilename: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const profile = (parsed.profile ?? {}) as Record<string, unknown>;
    const merged = {
      ...parsed,
      profile: {
        ...profile,
        built: true,
        cv_analyzed: true,
        cv_filename: cvFilename,
        cv_summary: analysis.summary ?? null,
        cv_fit_score:
          typeof analysis.fit_score === "number" ? analysis.fit_score : null,
        name: analysis.name?.trim() || (profile as { name?: string }).name || "",
        headline:
          analysis.headline?.trim() ||
          (profile as { headline?: string }).headline ||
          "",
        strengths: analysis.strengths?.length
          ? analysis.strengths
          : (profile as { strengths?: string[] }).strengths ?? [],
        gaps: analysis.gaps?.length
          ? analysis.gaps
          : (profile as { gaps?: string[] }).gaps ?? [],
        recommendations: analysis.recommendations?.length
          ? analysis.recommendations
          : (profile as { recommendations?: string[] }).recommendations ?? [],
        target_role_categories: analysis.target_role_categories?.length
          ? analysis.target_role_categories
          : (profile as { target_role_categories?: string[] })
              .target_role_categories ?? [],
        location_preferences: analysis.location_preferences?.length
          ? analysis.location_preferences
          : (profile as { location_preferences?: string[] })
              .location_preferences ?? [],
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* ignore — Overview will rebuild from defaults */
  }
}
