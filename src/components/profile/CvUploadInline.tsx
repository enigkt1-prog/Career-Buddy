import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { extractCvText } from "@/lib/cv-parser";
import { type CvAnalysisResponse } from "@/lib/cv-storage";
import { setProfileFromAnalysis } from "@/lib/profile-store";
import { supabase } from "@/integrations/supabase/client";
import { VoiceMic } from "@/components/voice/VoiceMic";

/**
 * Inline CV upload card. Phase 0.5 — replaces the previous "Upload on
 * Overview" deep link that bounced the user back and forth. Uses the
 * same `extractCvText` parser + `analyze-cv` edge function as the
 * Overview's existing CV section, and persists via
 * `setProfileFromAnalysis` (lib/profile-store) which writes
 * `career-buddy-state` AND best-effort upserts the same shape into
 * the Supabase `user_profile` table (migration 0012). Local stays
 * canonical so the upload still works offline.
 *
 * `onAnalysed` fires after a successful analysis so the parent
 * (Profile route) can refresh derived state (Section 03 Skills) from
 * the freshly-written localStorage without a page reload.
 */
type Props = { onAnalysed?: () => void };

export function CvUploadInline({ onAnalysed }: Props = {}) {
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
      await setProfileFromAnalysis(payload.analysis, filename ?? "cv.txt");
      setSummary(payload.analysis.summary ?? "Analysis complete. Open Overview to review.");
      setPhase("done");
      onAnalysed?.();
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

      <div className="relative">
        <textarea
          rows={4}
          className="w-full border border-cinema-mint rounded-glass p-3 pr-14 text-base font-mono bg-white/80 text-cinema-ink resize-y focus:outline-none focus:ring-2 focus:ring-cinema-sage"
          placeholder="…or paste CV text here, then click Analyse"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="absolute top-2 right-2">
          <VoiceMic
            size="sm"
            onTranscript={(t) =>
              setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))
            }
            disabled={phase === "analysing"}
            label="Dictate CV text"
          />
        </div>
      </div>
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

