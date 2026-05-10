import { Pencil } from "lucide-react";

import { fitColor } from "@/lib/format";
import { profileCompleteness } from "@/lib/jobs-helpers";
import type { Profile } from "@/lib/types";

/**
 * Profile summary card rendered on the Overview monolith. Pure
 * presentational: parent owns the state + sync logic.
 *
 * Collapsed view = one-line summary + completeness meter + edit/expand
 * buttons (used after Supabase sync finishes if profile.collapsed is
 * true). Expanded view = full profile fields + CV analysis section.
 */

export function ProfileCard({
  profile,
  onEdit,
  onExpand,
  syncCompleted,
}: {
  profile: Profile;
  onEdit: () => void;
  onExpand: () => void;
  syncCompleted: boolean;
}) {
  const collapsed = profile.collapsed && syncCompleted;
  const completeness = profileCompleteness(profile);

  if (collapsed) {
    return (
      <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
        <div className="min-w-0 flex-1 pr-4">
          <div className="truncate">
            {profile.name || "Profile"} · {profile.target_role} · {profile.target_geo}
          </div>
          <CompletenessMeter completeness={completeness} compact />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onEdit} className="text-xs underline" style={{ color: "#1c2620" }}>
            edit profile
          </button>
          <button onClick={onExpand} className="text-xs text-gray-400 underline">
            expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-gray-50 rounded-lg p-4 text-sm space-y-1">
      <div className="flex items-start justify-between mb-1">
        <div className="space-y-1 flex-1">
          <CompletenessMeter completeness={completeness} />
          <ProfileLine label="Name" value={profile.name || "—"} />
          <ProfileLine label="Target Role" value={profile.target_role} />
          <ProfileLine label="Target Geo" value={profile.target_geo} />
          <ProfileLine label="Background" value={profile.background} />
          <ProfileLine label="Strengths" value={profile.strengths.join(", ") || "—"} />
          <ProfileLine label="Gaps" value={profile.gaps.join(", ") || "—"} />
        </div>
        <button
          onClick={onEdit}
          className="text-xs px-3 py-1.5 border rounded-lg flex items-center gap-1.5 text-gray-700 hover:bg-white"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>
      {profile.cv_analyzed && (
        <div className="mt-3 pt-3 border-t">
          <div className="font-medium mb-2">
            CV analysis
            {profile.cv_filename && <span className="ml-2 text-xs text-gray-500 font-normal">— {profile.cv_filename}</span>}
          </div>
          <div className="space-y-2 text-gray-700">
            {profile.cv_summary && <div className="text-sm">{profile.cv_summary}</div>}
            {profile.cv_fit_score !== null && (
              <div className="text-sm">
                <span className="font-medium">Fit score:</span>{" "}
                <span className={fitColor(profile.cv_fit_score)}>{profile.cv_fit_score.toFixed(1)}</span>
              </div>
            )}
            {profile.recommendations.length > 0 && (
              <Section title="Recommendations" items={profile.recommendations} />
            )}
            {profile.work_history.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-2 mb-1">Experience</div>
                <ul className="space-y-2 text-sm">
                  {profile.work_history.slice(0, 4).map((p) => (
                    <li key={p.id} className="leading-snug">
                      <div className="font-medium">
                        {p.role} · {p.company}
                      </div>
                      <div className="text-xs text-gray-500">
                        {p.start_date}
                        {p.end_date && ` — ${p.end_date}`}
                        {p.location && ` · ${p.location}`}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-500 w-28 inline-block">{label}:</span> {value}
    </div>
  );
}

function CompletenessMeter({
  completeness,
  compact,
}: {
  completeness: { score: number; done: number; total: number };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-2 max-w-xs" : "mb-3 max-w-md"}>
      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
        <span>Profile completeness</span>
        <span>
          {completeness.score}% · {completeness.done}/{completeness.total}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-cinema-moss transition-all"
          style={{ width: `${completeness.score}%` }}
        />
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-2 mb-1">{title}</div>
      <ul className="list-disc pl-5 text-sm space-y-1">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
