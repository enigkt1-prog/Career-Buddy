import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { DRAFT_KIND_LABEL, type DraftKind, type DraftResult, type Profile, type VcJob } from "@/lib/types";

/**
 * Cover-letter / outreach draft modal. Calls the `draft-message`
 * Supabase edge function (Gemini-backed) with profile + job context,
 * shows subject + body, lets the user copy either field or both.
 *
 * Re-runs when `activeKind` changes so flipping between cover-letter
 * and outreach types regenerates without closing the modal.
 */

export function DraftModal({
  profile,
  job,
  kind,
  onClose,
}: {
  profile: Profile;
  job: VcJob | undefined;
  kind: DraftKind;
  onClose: () => void;
}) {
  const [activeKind, setActiveKind] = useState<DraftKind>(kind);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | "all" | null>(null);

  useEffect(() => {
    if (!job) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    void (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("draft-message", {
          body: {
            profile: {
              name: profile.name,
              headline: profile.headline,
              target_role: profile.target_role,
              target_geo: profile.target_geo,
              background: profile.background,
              strengths: profile.strengths,
              work_history: profile.work_history,
            },
            job: {
              company: job.company,
              role: job.role,
              location: job.location,
              description: job.description ?? "",
              requirements: job.requirements ?? "",
            },
            kind: activeKind,
          },
        });
        if (fnErr) throw fnErr;
        const payload = data as { draft?: DraftResult; error?: string };
        if (!payload?.draft) throw new Error(payload?.error || "No draft returned");
        setDraft(payload.draft);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Draft failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [activeKind, job, profile]);

  function copy(part: "subject" | "body" | "all") {
    if (!draft) return;
    const text =
      part === "subject"
        ? draft.subject
        : part === "body"
        ? draft.body
        : `Subject: ${draft.subject}\n\n${draft.body}`;
    void navigator.clipboard.writeText(text);
    setCopied(part);
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white rounded-t-xl">
          <h3 className="text-lg font-semibold">
            Draft message{job ? ` — ${job.company}` : ""}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 border-b flex flex-wrap gap-2 bg-gray-50">
          {(Object.keys(DRAFT_KIND_LABEL) as DraftKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setActiveKind(k)}
              className={`text-xs px-2.5 py-1 rounded-full border ${activeKind === k ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
            >
              {DRAFT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Asking Gemini…
            </div>
          )}
          {error && <div className="text-sm text-red-600">{error}</div>}
          {draft && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Subject</label>
                  <button onClick={() => copy("subject")} className="text-xs text-cinema-pine hover:underline">
                    {copied === "subject" ? "copied" : "copy"}
                  </button>
                </div>
                <input readOnly value={draft.subject} className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Body</label>
                  <button onClick={() => copy("body")} className="text-xs text-cinema-pine hover:underline">
                    {copied === "body" ? "copied" : "copy"}
                  </button>
                </div>
                <textarea readOnly value={draft.body} rows={14} className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 font-mono leading-relaxed" />
              </div>
              {draft.bullet_points_used && draft.bullet_points_used.length > 0 && (
                <div className="text-[10px] text-gray-400">
                  Anchored on: {draft.bullet_points_used.join(" · ")}
                </div>
              )}
            </>
          )}
        </div>
        <div className="border-t px-6 py-4 flex items-center justify-between gap-2 bg-white rounded-b-xl">
          <span className="text-[10px] text-gray-400">All drafts: review before sending — model is helpful, not perfect.</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Close</button>
            <button
              onClick={() => copy("all")}
              disabled={!draft}
              className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40"
              style={{ backgroundColor: "#1c2620" }}
            >
              {copied === "all" ? "Copied" : "Copy subject + body"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
