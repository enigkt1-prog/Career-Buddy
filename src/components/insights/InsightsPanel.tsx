import { useMemo } from "react";

import type { Application, Profile, ScoredJob, Status, VcJob } from "@/lib/types";

/**
 * Insights panel — surfaces a handful of grounded observations from
 * the user's applications + the live job feed. Pure presentational;
 * computeInsights is a deterministic helper given the same inputs.
 */

export function InsightsPanel({
  shimmer,
  onRefresh,
  applications,
  jobs,
  profile,
  rankedJobs,
}: {
  shimmer: boolean;
  onRefresh: () => void;
  applications: Application[];
  jobs: VcJob[];
  profile: Profile;
  rankedJobs: ScoredJob[];
}) {
  const insights = useMemo(
    () => computeInsights(applications, jobs, profile, rankedJobs),
    [applications, jobs, profile, rankedJobs],
  );
  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Patterns</h3>
      {insights.length === 0 ? (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-500 italic">
          Apply to a few roles or upload your CV — insights show up as you use the tracker.
        </div>
      ) : (
        insights.map((b, i) => (
          <div
            key={i}
            className={`bg-gray-50 rounded-lg p-4 mb-2 text-sm ${shimmer ? "animate-pulse" : ""}`}
          >
            {b}
          </div>
        ))
      )}
      <button onClick={onRefresh} className="text-xs underline mt-1" style={{ color: "#1c2620" }}>
        Refresh patterns
      </button>
    </div>
  );
}

function computeInsights(
  applications: Application[],
  jobs: VcJob[],
  profile: Profile,
  rankedJobs: ScoredJob[],
): string[] {
  const out: string[] = [];

  // 1. Status mix — funnel snapshot
  const statusCounts = new Map<Status, number>();
  for (const a of applications) {
    statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
  }
  const total = applications.length;
  if (total > 0) {
    const interviews = (statusCounts.get("interview-1") ?? 0) + (statusCounts.get("interview-2") ?? 0);
    const offers = statusCounts.get("offer") ?? 0;
    const rejected = statusCounts.get("rejected") ?? 0;
    const responseRate = total > 0 ? Math.round(((interviews + offers + rejected) / total) * 100) : 0;
    out.push(
      `${total} applications · ${interviews} in interviews · ${offers} offers — ${responseRate}% response rate so far.`,
    );
  }

  // 2. Strongest-fit category in the live feed
  const catScores = new Map<string, { sum: number; count: number }>();
  for (const j of rankedJobs) {
    if (!j.role_category || j.role_category === "other") continue;
    const cur = catScores.get(j.role_category) ?? { sum: 0, count: 0 };
    cur.sum += j.fit;
    cur.count += 1;
    catScores.set(j.role_category, cur);
  }
  let bestCat: { name: string; avg: number; count: number } | null = null;
  for (const [name, v] of catScores) {
    const avg = v.sum / v.count;
    if (!bestCat || avg > bestCat.avg) bestCat = { name, avg, count: v.count };
  }
  if (bestCat && bestCat.count >= 2) {
    out.push(
      `Your strongest live category is ${bestCat.name} (avg fit ${bestCat.avg.toFixed(1)} across ${bestCat.count} roles).`,
    );
  }

  // 3. Most-frequent location in your top-10 fits
  const top10 = rankedJobs.slice(0, 10);
  const locCounts = new Map<string, number>();
  for (const j of top10) {
    const loc = (j.location || "").split(/[,/-]| - /)[0].trim();
    if (!loc || loc === "—") continue;
    locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1);
  }
  let topLoc: { name: string; count: number } | null = null;
  for (const [name, c] of locCounts) {
    if (!topLoc || c > topLoc.count) topLoc = { name, count: c };
  }
  if (topLoc && topLoc.count >= 3) {
    out.push(`${topLoc.count} of your top-10 fits are in ${topLoc.name} — concentrate outreach there.`);
  }

  // 4. Profile gap nudge
  const missing: string[] = [];
  if (!profile.cv_analyzed) missing.push("upload a CV");
  else if (profile.work_history.length === 0) missing.push("add at least one work-history position");
  else if (profile.strengths.length < 3) missing.push("list 3+ strengths");
  if (missing.length > 0) {
    out.push(`Tighten your profile — ${missing[0]} so fit scores get more accurate.`);
  }

  // 5. Recency lift
  const today = Date.now();
  const recentJobs = jobs.filter((j) => {
    if (!j.posted_date) return false;
    return today - new Date(j.posted_date).getTime() <= 7 * 86_400_000;
  });
  if (recentJobs.length >= 5) {
    out.push(`${recentJobs.length} of your live roles were posted this week — fresh JDs respond 2-3× faster.`);
  }

  // 6. Match-quality concentration
  const high = rankedJobs.filter((j) => j.fit >= 7.5).length;
  if (rankedJobs.length > 0) {
    const pct = Math.round((high / rankedJobs.length) * 100);
    if (high >= 3) {
      out.push(`${high} of ${rankedJobs.length} live roles score 7.5+ (${pct}%) — that's your prioritised pile.`);
    }
  }

  return out;
}
