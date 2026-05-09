import { useEffect, useMemo, useState } from "react";
import { Mail, Loader2, Upload } from "lucide-react";
import { extractCvText } from "@/lib/cv-parser";
import { supabase } from "@/integrations/supabase/client";

type Status =
  | "applied"
  | "interview-1"
  | "interview-2"
  | "rejected"
  | "offer"
  | "follow-up-needed"
  | "confirmation";

type Application = {
  id: string;
  company: string;
  role: string;
  status: Status;
  last_event: string;
  next_action: string;
  fit: number;
  flash?: boolean;
};

type Profile = {
  built: boolean;
  cv_analyzed: boolean;
  collapsed: boolean;
  cv_analysis?: CvAnalysis | null;
  cv_filename?: string | null;
};

type State = {
  applications: Application[];
  profile: Profile;
  sync_completed: boolean;
};

type MockEmail = {
  matches_company: string;
  expected_classification:
    | "rejection"
    | "interview-invite"
    | "confirmation"
    | "follow-up-question"
    | "offer";
  subject: string;
  from: string;
  date: string;
  body: string;
};

type VcJob = {
  company: string;
  role: string;
  location: string;
  url: string;
  ats_source: string;
  posted_date: string | null;
};

function relativeDays(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

type CvAnalysis = {
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  fit_score: number;
  summary: string;
};

const STORAGE_KEY = "career-buddy-state";

const SEED_APPS: Application[] = [
  { id: "a1", company: "Pedlar", role: "Founders Associate", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 7.2 },
  { id: "a2", company: "Avi", role: "Investment Analyst", status: "applied", last_event: "2 days ago", next_action: "Awaiting reply", fit: 8.4 },
  { id: "a3", company: "Rust", role: "Operating Associate", status: "applied", last_event: "6 days ago", next_action: "Awaiting reply", fit: 6.8 },
  { id: "a4", company: "Picus Capital", role: "FA Program", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 8.1 },
  { id: "a5", company: "Cherry Ventures", role: "Investment Analyst", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 7.4 },
  { id: "a6", company: "Project A", role: "Strategy Associate", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 7.9 },
  { id: "a7", company: "Earlybird", role: "Investment Analyst", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 6.5 },
  { id: "a8", company: "Speedinvest", role: "Investment Associate", status: "applied", last_event: "—", next_action: "Awaiting reply", fit: 8.7 },
];

const FIT_SCORES: Record<string, number> = {
  "Cherry Ventures": 8.7,
  "Earlybird Venture Capital": 8.4,
  "Project A Ventures": 8.1,
  "Picus Capital": 7.9,
  Speedinvest: 7.7,
  "HV Capital": 7.5,
  Lakestar: 7.3,
  Atomico: 7.1,
  "General Catalyst": 6.9,
  Plural: 6.7,
  "9Yards Capital": 6.5,
  "468 Capital": 6.3,
  Sastrify: 6.1,
  "Trade Republic": 5.9,
  Helsing: 5.7,
};

function loadState(): State {
  if (typeof window === "undefined") {
    return { applications: SEED_APPS, profile: { built: false, cv_analyzed: false, collapsed: false }, sync_completed: false };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {}
  return { applications: SEED_APPS, profile: { built: false, cv_analyzed: false, collapsed: false }, sync_completed: false };
}

function statusBadge(s: Status) {
  const map: Record<Status, string> = {
    applied: "bg-gray-100 text-gray-700",
    "interview-1": "bg-blue-100 text-blue-800",
    "interview-2": "bg-blue-200 text-blue-900",
    rejected: "bg-red-100 text-red-700",
    offer: "bg-green-100 text-green-700",
    "follow-up-needed": "bg-yellow-100 text-yellow-800",
    confirmation: "bg-gray-50 text-gray-600",
  };
  return map[s];
}

function fitColor(f: number) {
  if (f >= 8.0) return "text-green-600";
  if (f >= 5.0) return "text-yellow-600";
  return "text-red-600";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CareerBuddy() {
  const [state, setState] = useState<State>(() => loadState());
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [cvText, setCvText] = useState("");
  const [cvLoading, setCvLoading] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [cvFilename, setCvFilename] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [emails, setEmails] = useState<MockEmail[]>([]);
  const [jobs, setJobs] = useState<VcJob[]>([]);
  const [insightsShimmer, setInsightsShimmer] = useState(false);

  useEffect(() => {
    if (state.profile.built) setChatReply(CANNED_REPLY);
  }, []); // eslint-disable-line

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    fetch("/data/mock_emails.json").then((r) => r.json()).then(setEmails).catch(() => {});
    void (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("company_name, role_title, location, url, ats_source, posted_date")
        .eq("is_active", true)
        .order("posted_date", { ascending: false, nullsFirst: false })
        .limit(30);
      if (error) {
        console.error("[jobs] fetch failed", error);
        return;
      }
      const rows = (data ?? []) as Array<{
        company_name: string;
        role_title: string;
        location: string | null;
        url: string;
        ats_source: string;
        posted_date: string | null;
      }>;
      setJobs(
        rows.map((r) => ({
          company: r.company_name,
          role: r.role_title,
          location: r.location ?? "—",
          url: r.url,
          ats_source: r.ats_source,
          posted_date: r.posted_date,
        })),
      );
    })();
  }, []);

  function buildProfile() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setTimeout(() => {
      setChatLoading(false);
      setChatReply(CANNED_REPLY);
      setState((s) => ({ ...s, profile: { ...s.profile, built: true, collapsed: false } }));
    }, 600);
  }

  async function handleFile(file: File) {
    setCvError(null);
    setCvFilename(file.name);
    try {
      const text = await extractCvText(file);
      setCvText(text);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Could not read file");
    }
  }

  async function analyzeCv() {
    if (!cvText.trim()) {
      setCvError("Paste CV text or upload a .pdf/.docx file first.");
      return;
    }
    setCvError(null);
    setCvLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-cv", {
        body: {
          cvText,
          targetProfile:
            "Founders Associate / Operating Associate, Berlin / Remote-DACH, business-background grad (CLSBE Master).",
        },
      });
      if (error) throw error;
      const analysis = (data as { analysis?: CvAnalysis; error?: string })?.analysis;
      if (!analysis) throw new Error((data as { error?: string })?.error || "No analysis returned");
      setState((s) => ({
        ...s,
        profile: {
          ...s.profile,
          cv_analyzed: true,
          cv_analysis: analysis,
          cv_filename: cvFilename,
        },
      }));
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setCvLoading(false);
    }
  }

  function addApplication(company: string, role: string) {
    const newApp: Application = {
      id: `a${Date.now()}`,
      company,
      role,
      status: "applied",
      last_event: todayISO(),
      next_action: "Prep B2B-deal example",
      fit: 8.4,
    };
    setState((s) => ({ ...s, applications: [...s.applications, newApp] }));
  }

  function syncInbox() {
    if (syncing) return;
    setSyncing(true);
    setSummary(null);

    const order = ["Pedlar", "Avi", "Picus Capital", "Cherry Ventures", "Project A", "Earlybird", "Rust", "Speedinvest"];

    order.forEach((company, i) => {
      setTimeout(() => {
        setState((s) => ({
          ...s,
          applications: s.applications.map((a) => (a.company === company ? applyEmail(a, company) : a)),
        }));
        setTimeout(() => {
          setState((s) => ({
            ...s,
            applications: s.applications.map((a) => (a.company === company ? { ...a, flash: false } : a)),
          }));
        }, 400);
      }, i * 250);
    });

    setTimeout(() => {
      setSyncing(false);
      setSummary("8 emails scanned · 6 applications updated · 6 next actions created · 1 offer received");
      setState((s) => ({ ...s, sync_completed: true, profile: { ...s.profile, collapsed: true } }));
    }, 2200);
  }

  function applyEmail(a: Application, company: string): Application {
    const date = todayISO();
    switch (company) {
      case "Pedlar":
        return { ...a, status: "rejected", next_action: "Ask for feedback (draft ready)", last_event: date, flash: true };
      case "Avi":
        return { ...a, status: "interview-2", next_action: "Thu 3pm CET market sizing case", last_event: date, flash: true };
      case "Picus Capital":
        return { ...a, status: "interview-2", next_action: "Coffee chat — pick 3 slots", last_event: date, flash: true };
      case "Cherry Ventures":
        return { ...a, status: "rejected", next_action: "Ask for feedback (draft ready)", last_event: date, flash: true };
      case "Project A":
        return { ...a, status: "follow-up-needed", next_action: "Reply to Kim: B2B deal example", last_event: date, flash: true };
      case "Speedinvest":
        return { ...a, status: "offer", next_action: "Review offer letter — €52k base", last_event: date, flash: true };
      case "Earlybird":
      case "Rust":
        return { ...a, last_event: date, flash: true };
      default:
        return a;
    }
  }

  function resetDemo() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.location.reload();
  }

  function refreshInsights() {
    setInsightsShimmer(true);
    setTimeout(() => setInsightsShimmer(false), 300);
  }

  const rankedJobs = useMemo(() => {
    return jobs
      .map((j) => ({ ...j, fit: FIT_SCORES[j.company] ?? 6.0 }))
      .sort((a, b) => b.fit - a.fit);
  }, [jobs]);

  const top3 = new Set(rankedJobs.slice(0, 3).map((j) => j.company));

  return (
    <div className="min-h-screen bg-white text-[#111827]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="font-semibold text-lg" style={{ color: "#7c3aed" }}>Career-Buddy</div>
          <div className="flex items-center gap-4">
            <span className="text-xs bg-gray-100 rounded-full px-3 py-1">Mock AI mode · cached demo responses</span>
            <button onClick={resetDemo} className="text-xs text-gray-400 underline">Reset demo</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6">
        {/* Section 1 */}
        <section className="py-8">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Land your first startup role.</h1>
          <p className="text-base text-gray-500 mb-6">
            Track applications, learn what works, find roles that fit. For business-background grads chasing Founders-Associate, BizOps, Strategy, BD.
          </p>

          <div className="bg-white border rounded-xl shadow-sm p-5 mb-4">
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderRadius: 8 }}
                placeholder="Tell me what kind of role you want and your background."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buildProfile()}
              />
              <button
                onClick={buildProfile}
                disabled={chatLoading}
                className="px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
                style={{ backgroundColor: "#7c3aed" }}
              >
                {chatLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {chatLoading ? "Building your profile…" : "Build profile"}
              </button>
            </div>

            {chatReply && (
              <div className="mt-4 bg-gray-50 rounded-lg p-3 text-sm">{chatReply}</div>
            )}

            {(state.profile.built || chatReply) && <ProfileCard state={state} setState={setState} />}
          </div>

          {(state.profile.built || chatReply) && (
            <div className="bg-white border rounded-xl shadow-sm p-5">
              <label className="text-sm font-medium block mb-2">Upload or paste your CV</label>
              <div className="flex items-center gap-3 mb-3">
                <label className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg cursor-pointer hover:bg-gray-50">
                  <Upload className="w-4 h-4" />
                  <span>Upload .pdf / .docx</span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </label>
                {cvFilename && <span className="text-xs text-gray-500">{cvFilename}</span>}
              </div>
              <textarea
                rows={4}
                className="w-full border rounded-lg p-2 text-sm"
                style={{ borderRadius: 8 }}
                placeholder="…or paste CV text here"
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
              />
              {cvError && <div className="mt-2 text-xs text-red-600">{cvError}</div>}
              <button
                onClick={analyzeCv}
                disabled={cvLoading}
                className="mt-3 px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
                style={{ backgroundColor: "#7c3aed" }}
              >
                {cvLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {cvLoading ? "Analyzing…" : "Analyze CV"}
              </button>
            </div>
          )}
        </section>

        {/* Workbench */}
        <section className="py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <ApplicationsTracker
              applications={state.applications}
              onAdd={() => setShowAdd(true)}
              onSync={syncInbox}
              syncing={syncing}
              summary={summary}
            />
          </div>
          <div className="md:col-span-1">
            <div className="md:sticky md:top-20">
              <InsightsPanel shimmer={insightsShimmer} onRefresh={refreshInsights} />
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="py-8">
          <h2 className="text-2xl font-semibold mb-1">Roles you might fit</h2>
          <p className="text-sm text-gray-500 mb-6">
            {rankedJobs.length === 0
              ? "Loading live openings…"
              : `${rankedJobs.length} live openings, ranked by fit to your profile.`}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rankedJobs.map((j) => {
              const isTop = top3.has(j.company);
              const why = isTop
                ? "Matches your B2B + Series-A focus — direct overlap with target."
                : "DACH-based VC with FA-track openings — review JD.";
              return (
                <div
                  key={`${j.company}-${j.role}-${j.url}`}
                  className={`relative bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition ${isTop ? "ring-2 ring-purple-500 ring-opacity-50 animate-pulse" : ""}`}
                >
                  <div className={`absolute top-3 right-3 text-sm font-bold ${fitColor(j.fit)}`}>{j.fit.toFixed(1)}</div>
                  <div className="font-semibold text-base">{j.company}</div>
                  <div className="text-sm">{j.role}</div>
                  <div className="text-xs text-gray-500">{j.location}</div>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                      {j.ats_source}
                    </span>
                    <span className="text-gray-400">{relativeDays(j.posted_date)}</span>
                  </div>
                  <div className="text-sm mt-3 italic">{why}</div>
                  <button
                    onClick={() => addApplication(j.company, j.role)}
                    className="mt-4 text-xs px-3 py-1 border rounded-lg"
                    style={{ borderColor: "#7c3aed", color: "#7c3aed" }}
                  >
                    Add to tracker
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Section 5 */}
      <footer className="bg-gray-50 py-6 text-center mt-8">
        <div className="text-sm uppercase tracking-wider text-gray-500">Roadmap — for startup operators, not just VC-track</div>
        <div className="text-base text-gray-700 mt-2 max-w-3xl mx-auto px-6">
          Today: tracker + insights + role-feed. Next: skill recommender (courses, events, Maven cohorts). Year-1: persistent Career-Buddy with multi-year memory — switch-timing, salary-negotiation, headhunter broker.
        </div>
      </footer>

      {showAdd && <AddAppModal onClose={() => setShowAdd(false)} onAdd={addApplication} />}
    </div>
  );
}

const CANNED_REPLY =
  "Got it. Target: Founders Associate at AI-startups + Operating Associate / BizOps / Strategy roles at early-stage startups. Geo: Berlin / Remote-DACH. Background: CLSBE Master, business track, 0–2y experience.";

function ProfileCard({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const collapsed = state.profile.collapsed && state.sync_completed;

  if (collapsed) {
    return (
      <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
        <span>Troels K. · Founders Associate · Berlin / Remote-DACH · CLSBE Master</span>
        <button
          onClick={() => setState((s) => ({ ...s, profile: { ...s.profile, collapsed: false } }))}
          className="text-xs underline"
          style={{ color: "#7c3aed" }}
        >
          edit profile
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-gray-50 rounded-lg p-4 text-sm space-y-1">
      <div><span className="text-gray-500 w-28 inline-block">Name:</span> Troels K.</div>
      <div><span className="text-gray-500 w-28 inline-block">Target Role:</span> Founders Associate / Operating Associate</div>
      <div><span className="text-gray-500 w-28 inline-block">Target Geo:</span> DACH (Berlin / Remote)</div>
      <div><span className="text-gray-500 w-28 inline-block">Background:</span> CLSBE Master, business track</div>
      <div><span className="text-gray-500 w-28 inline-block">Strong:</span> B2B-sales, structured thinking</div>
      <div><span className="text-gray-500 w-28 inline-block">Gap:</span> SaaS-metrics, ML fundamentals</div>
      {state.profile.cv_analyzed && (
        <div className="mt-3 pt-3 border-t">
          <div className="font-medium mb-2">
            CV analysis
            {state.profile.cv_filename && (
              <span className="ml-2 text-xs text-gray-500 font-normal">— {state.profile.cv_filename}</span>
            )}
          </div>
          {state.profile.cv_analysis ? (
            <div className="space-y-2 text-gray-700">
              <div className="text-sm">{state.profile.cv_analysis.summary}</div>
              <div className="text-sm">
                <span className="font-medium">Fit score:</span>{" "}
                <span className={fitColor(state.profile.cv_analysis.fit_score)}>
                  {state.profile.cv_analysis.fit_score.toFixed(1)}
                </span>
              </div>
              <Section title="Strengths" items={state.profile.cv_analysis.strengths} />
              <Section title="Gaps" items={state.profile.cv_analysis.gaps} />
              <Section title="Recommendations" items={state.profile.cv_analysis.recommendations} />
            </div>
          ) : (
            <div className="text-gray-700 text-sm">Strong: B2B-sales, structured thinking. Gap: SaaS-metrics, ML fundamentals.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mt-2 mb-1">{title}</div>
      <ul className="list-disc pl-5 text-sm space-y-1">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function ApplicationsTracker({
  applications,
  onAdd,
  onSync,
  syncing,
  summary,
}: {
  applications: Application[];
  onAdd: () => void;
  onSync: () => void;
  syncing: boolean;
  summary: string | null;
}) {
  return (
    <div className="bg-white border rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Applications</h2>
        <div className="flex gap-2">
          <button onClick={onAdd} className="px-3 py-2 text-sm bg-white border rounded-lg">+ Add Application</button>
          <button
            onClick={onSync}
            disabled={syncing}
            className="px-6 py-2.5 rounded-lg text-white font-semibold shadow-md hover:shadow-lg flex items-center gap-2"
            style={{ backgroundColor: "#7c3aed" }}
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {syncing ? "Scanning 8 cached emails…" : "Sync Inbox"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 border-b">
            <tr>
              <th className="text-left py-2 px-2">Company</th>
              <th className="text-left py-2 px-2">Role</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Last Event</th>
              <th className="text-left py-2 px-2">Next Action</th>
              <th className="text-left py-2 px-2">Fit</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr
                key={a.id}
                className={`border-b transition-colors ease-out ${a.flash ? "bg-purple-100" : ""}`}
                style={{ transitionDuration: "400ms" }}
              >
                <td className="py-2 px-2 font-medium">{a.company}</td>
                <td className="py-2 px-2">{a.role}</td>
                <td className="py-2 px-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusBadge(a.status)}`}>{a.status}</span>
                </td>
                <td className="py-2 px-2 text-gray-600">{a.last_event}</td>
                <td className="py-2 px-2">{a.next_action}</td>
                <td className={`py-2 px-2 font-semibold ${fitColor(a.fit)}`}>{a.fit.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary && (
        <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3 text-sm">{summary}</div>
      )}
    </div>
  );
}

function InsightsPanel({ shimmer, onRefresh }: { shimmer: boolean; onRefresh: () => void }) {
  const bullets = [
    "B2B-focused VC roles respond 3× more than B2C — focus your pipeline.",
    "Picus Capital pipeline avg 21 days — be patient, not silent.",
    "Strong-fit signals: Series-A + Berlin + B2B SaaS exposure.",
  ];
  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Patterns</h3>
      {bullets.map((b, i) => (
        <div key={i} className={`bg-gray-50 rounded-lg p-4 mb-2 text-sm ${shimmer ? "animate-pulse" : ""}`}>{b}</div>
      ))}
      <button onClick={onRefresh} className="text-xs underline mt-1" style={{ color: "#7c3aed" }}>Refresh patterns</button>
    </div>
  );
}

function AddAppModal({ onClose, onAdd }: { onClose: () => void; onAdd: (company: string, role: string) => void }) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || !role.trim()) return;
    setLoading(true);
    setTimeout(() => {
      onAdd(company, role);
      setLoading(false);
      onClose();
    }, 700);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md"
      >
        <h3 className="text-lg font-semibold mb-4">Add Application</h3>
        <div className="space-y-3">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm text-white rounded-lg flex items-center gap-2"
            style={{ backgroundColor: "#7c3aed" }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Add
          </button>
        </div>
      </form>
    </div>
  );
}