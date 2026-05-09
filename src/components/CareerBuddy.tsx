import { useEffect, useMemo, useState } from "react";
import { Mail, Loader2, Upload, Pencil, Plus, Trash2, X } from "lucide-react";
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

type Position = {
  id: string;
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  location?: string;
  bullets: string[];
};

type Education = {
  id: string;
  institution: string;
  degree: string;
  start_date?: string;
  end_date?: string;
};

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
  work_history?: Array<Omit<Position, "id">>;
  education?: Array<Omit<Education, "id">>;
};

type Profile = {
  built: boolean;
  cv_analyzed: boolean;
  collapsed: boolean;
  name: string;
  target_role: string;
  target_geo: string;
  background: string;
  headline: string;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  target_role_categories: string[];
  location_preferences: string[];
  work_history: Position[];
  education: Education[];
  cv_filename: string | null;
  cv_summary: string | null;
  cv_fit_score: number | null;
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
  role_category: string | null;
  location: string;
  url: string;
  ats_source: string;
  posted_date: string | null;
  is_remote: boolean;
};

type ScoredJob = VcJob & { fit: number; why: string };

const STORAGE_KEY = "career-buddy-state";

const DEFAULT_PROFILE: Profile = {
  built: false,
  cv_analyzed: false,
  collapsed: false,
  name: "",
  target_role: "Founders Associate / Operating Associate",
  target_geo: "Berlin / Remote-DACH",
  background: "Business-background grad, 0-2 years experience",
  headline: "",
  strengths: ["B2B-sales", "Structured thinking"],
  gaps: ["SaaS metrics", "ML fundamentals"],
  recommendations: [],
  target_role_categories: ["founders-associate", "bizops", "strategy"],
  location_preferences: ["Berlin", "Remote-DACH"],
  work_history: [],
  education: [],
  cv_filename: null,
  cv_summary: null,
  cv_fit_score: null,
};

const ROLE_CATEGORY_OPTIONS = [
  "founders-associate",
  "bizops",
  "strategy",
  "bd",
  "chief-of-staff",
  "investment-analyst",
] as const;

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

const DACH_CITIES = ["berlin", "munich", "münchen", "hamburg", "köln", "cologne", "frankfurt", "vienna", "wien", "zurich", "zürich", "düsseldorf"];

function emptyState(): State {
  return {
    applications: SEED_APPS,
    profile: { ...DEFAULT_PROFILE },
    sync_completed: false,
  };
}

function migrateProfile(raw: unknown): Profile {
  const base = { ...DEFAULT_PROFILE };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const arr = (k: string): string[] => (Array.isArray(r[k]) ? (r[k] as string[]).filter((x) => typeof x === "string") : base[k as keyof Profile] as string[]);
  const str = (k: string, fb: string): string => (typeof r[k] === "string" ? (r[k] as string) : fb);
  const num = (k: string): number | null => (typeof r[k] === "number" ? (r[k] as number) : null);
  return {
    built: r.built === true,
    cv_analyzed: r.cv_analyzed === true,
    collapsed: r.collapsed === true,
    name: str("name", ""),
    target_role: str("target_role", base.target_role),
    target_geo: str("target_geo", base.target_geo),
    background: str("background", base.background),
    headline: str("headline", ""),
    strengths: arr("strengths"),
    gaps: arr("gaps"),
    recommendations: arr("recommendations"),
    target_role_categories: arr("target_role_categories"),
    location_preferences: arr("location_preferences"),
    work_history: Array.isArray(r.work_history) ? (r.work_history as Position[]).map((p, i) => ({ ...p, id: p.id || `w${i}_${Date.now()}` })) : [],
    education: Array.isArray(r.education) ? (r.education as Education[]).map((e, i) => ({ ...e, id: e.id || `e${i}_${Date.now()}` })) : [],
    cv_filename: typeof r.cv_filename === "string" ? r.cv_filename : null,
    cv_summary: typeof r.cv_summary === "string" ? r.cv_summary : null,
    cv_fit_score: num("cv_fit_score"),
  };
}

function loadState(): State {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as { applications?: Application[]; profile?: unknown; sync_completed?: boolean };
    return {
      applications: Array.isArray(parsed.applications) && parsed.applications.length > 0 ? parsed.applications : SEED_APPS,
      profile: migrateProfile(parsed.profile),
      sync_completed: parsed.sync_completed === true,
    };
  } catch {
    return emptyState();
  }
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

function fitScore(job: VcJob, profile: Profile): number {
  let score = 5.0;

  if (job.role_category && profile.target_role_categories.includes(job.role_category)) {
    score += 2.5;
  } else if (job.role_category && job.role_category !== "other") {
    score += 0.4;
  } else if (!job.role_category) {
    const t = `${job.role}`.toLowerCase();
    if (/founder|operating|biz ?ops|chief of staff|cos\b|strategy|partnerships|investment/.test(t)) {
      score += 1.5;
    }
  }

  const loc = (job.location || "").toLowerCase();
  const prefs = profile.location_preferences.map((p) => p.toLowerCase());
  const wantsRemote = prefs.some((p) => /remote/.test(p));
  if (wantsRemote && job.is_remote) score += 1.5;
  if (prefs.some((p) => p && loc.includes(p))) score += 1.5;
  else if (prefs.some((p) => /dach|germany|deutschland/.test(p)) && DACH_CITIES.some((c) => loc.includes(c))) score += 1.0;

  if (job.posted_date) {
    const days = (Date.now() - new Date(job.posted_date).getTime()) / 86_400_000;
    if (days <= 7) score += 0.5;
    else if (days <= 30) score += 0.2;
    else if (days > 90) score -= 0.5;
  }

  const haystack = `${job.role} ${job.company}`.toLowerCase();
  const overlaps = profile.strengths.filter((s) => {
    const word = s.toLowerCase().split(/[\s,/-]+/)[0];
    return word.length > 3 && haystack.includes(word);
  }).length;
  score += Math.min(overlaps * 0.3, 1.0);

  return Math.max(1.0, Math.min(9.9, Math.round(score * 10) / 10));
}

function fitWhy(job: VcJob, profile: Profile): string {
  const reasons: string[] = [];
  if (job.role_category && profile.target_role_categories.includes(job.role_category)) {
    reasons.push(`role match: ${job.role_category}`);
  }
  const loc = (job.location || "").toLowerCase();
  const prefs = profile.location_preferences.map((p) => p.toLowerCase());
  if (prefs.some((p) => p && loc.includes(p))) reasons.push(`location: ${job.location}`);
  else if (job.is_remote && prefs.some((p) => /remote/.test(p))) reasons.push("remote-friendly");
  else if (prefs.some((p) => /dach|germany|deutschland/.test(p)) && DACH_CITIES.some((c) => loc.includes(c))) reasons.push(`DACH: ${job.location}`);
  if (job.posted_date) {
    const days = (Date.now() - new Date(job.posted_date).getTime()) / 86_400_000;
    if (days <= 7) reasons.push("posted this week");
  }
  if (reasons.length === 0) return "Review JD to see if it fits.";
  return reasons.slice(0, 3).join(" · ");
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
  const [editProfileOpen, setEditProfileOpen] = useState(false);
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
        .select("company_name, role_title, role_category, location, url, ats_source, posted_date, is_remote")
        .eq("is_active", true)
        .order("posted_date", { ascending: false, nullsFirst: false })
        .limit(60);
      if (error) {
        console.error("[jobs] fetch failed", error);
        return;
      }
      const rows = (data ?? []) as Array<{
        company_name: string;
        role_title: string;
        role_category: string | null;
        location: string | null;
        url: string;
        ats_source: string;
        posted_date: string | null;
        is_remote: boolean | null;
      }>;
      setJobs(
        rows.map((r) => ({
          company: r.company_name,
          role: r.role_title,
          role_category: r.role_category,
          location: r.location ?? "—",
          url: r.url,
          ats_source: r.ats_source,
          posted_date: r.posted_date,
          is_remote: r.is_remote === true,
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
      if (!text || text.length < 50) {
        setCvError("Could not extract enough text from the file. Try pasting the CV instead.");
        return;
      }
      setCvText(text);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Could not read file");
    }
  }

  function applyAnalysis(analysis: CvAnalysisResponse) {
    setState((s) => {
      const p = s.profile;
      const work = (analysis.work_history ?? []).map((w, i) => ({
        id: `w${Date.now()}_${i}`,
        company: w.company || "",
        role: w.role || "",
        start_date: w.start_date || "",
        end_date: w.end_date || "",
        location: w.location,
        bullets: Array.isArray(w.bullets) ? w.bullets.filter((b) => typeof b === "string") : [],
      }));
      const edu = (analysis.education ?? []).map((e, i) => ({
        id: `e${Date.now()}_${i}`,
        institution: e.institution || "",
        degree: e.degree || "",
        start_date: e.start_date,
        end_date: e.end_date,
      }));
      return {
        ...s,
        profile: {
          ...p,
          cv_analyzed: true,
          cv_filename: cvFilename,
          cv_summary: analysis.summary ?? null,
          cv_fit_score: typeof analysis.fit_score === "number" ? analysis.fit_score : null,
          name: analysis.name?.trim() || p.name,
          headline: analysis.headline?.trim() || p.headline,
          strengths: Array.isArray(analysis.strengths) && analysis.strengths.length ? analysis.strengths : p.strengths,
          gaps: Array.isArray(analysis.gaps) && analysis.gaps.length ? analysis.gaps : p.gaps,
          recommendations: Array.isArray(analysis.recommendations) && analysis.recommendations.length ? analysis.recommendations : p.recommendations,
          target_role_categories: Array.isArray(analysis.target_role_categories) && analysis.target_role_categories.length ? analysis.target_role_categories : p.target_role_categories,
          location_preferences: Array.isArray(analysis.location_preferences) && analysis.location_preferences.length ? analysis.location_preferences : p.location_preferences,
          work_history: work.length ? work : p.work_history,
          education: edu.length ? edu : p.education,
        },
      };
    });
  }

  async function analyzeCv() {
    if (!cvText.trim()) {
      setCvError("Paste CV text or upload a .pdf/.docx file first.");
      return;
    }
    setCvError(null);
    setCvLoading(true);
    try {
      const target = `${state.profile.target_role}, ${state.profile.target_geo}, ${state.profile.background}`;
      const { data, error } = await supabase.functions.invoke("analyze-cv", {
        body: { cvText, targetProfile: target },
      });
      if (error) throw error;
      const payload = data as { analysis?: CvAnalysisResponse; error?: string };
      if (!payload?.analysis) throw new Error(payload?.error || "No analysis returned");
      applyAnalysis(payload.analysis);
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

  const rankedJobs: ScoredJob[] = useMemo(() => {
    return jobs
      .map((j) => ({
        ...j,
        fit: fitScore(j, state.profile),
        why: fitWhy(j, state.profile),
      }))
      .sort((a, b) => {
        if (b.fit !== a.fit) return b.fit - a.fit;
        const ad = a.posted_date ? new Date(a.posted_date).getTime() : 0;
        const bd = b.posted_date ? new Date(b.posted_date).getTime() : 0;
        return bd - ad;
      })
      .slice(0, 30);
  }, [jobs, state.profile]);

  const topThreshold = rankedJobs[2]?.fit ?? 0;

  return (
    <div className="min-h-screen bg-white text-[#111827]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
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

            {chatReply && <div className="mt-4 bg-gray-50 rounded-lg p-3 text-sm">{chatReply}</div>}

            {(state.profile.built || chatReply) && (
              <ProfileCard profile={state.profile} onEdit={() => setEditProfileOpen(true)} onExpand={() => setState((s) => ({ ...s, profile: { ...s.profile, collapsed: false } }))} syncCompleted={state.sync_completed} />
            )}
          </div>

          {(state.profile.built || chatReply) && (
            <div className="bg-white border rounded-xl shadow-sm p-5">
              <label className="text-sm font-medium block mb-2">Upload or paste your CV</label>
              <div className="flex items-center gap-3 mb-3">
                <label className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg cursor-pointer hover:bg-gray-50">
                  <Upload className="w-4 h-4" />
                  <span>Upload .pdf / .docx / .txt</span>
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
                className="w-full border rounded-lg p-2 text-sm font-mono"
                style={{ borderRadius: 8 }}
                placeholder="…or paste CV text here"
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
              />
              {cvError && <div className="mt-2 text-xs text-red-600">{cvError}</div>}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={analyzeCv}
                  disabled={cvLoading}
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-2"
                  style={{ backgroundColor: "#7c3aed" }}
                >
                  {cvLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {cvLoading ? "Analyzing CV…" : state.profile.cv_analyzed ? "Re-analyze CV" : "Analyze CV"}
                </button>
                {state.profile.cv_analyzed && (
                  <button
                    onClick={() => setEditProfileOpen(true)}
                    className="px-3 py-2 text-sm border rounded-lg flex items-center gap-1.5 text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Review & edit profile
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

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

        <section className="py-8">
          <h2 className="text-2xl font-semibold mb-1">Roles you might fit</h2>
          <p className="text-sm text-gray-500 mb-6">
            {rankedJobs.length === 0
              ? "Loading live openings…"
              : `${rankedJobs.length} live openings, ranked by your profile + CV.`}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rankedJobs.map((j, idx) => {
              const isTop = idx < 3 && j.fit >= 7.0 && j.fit >= topThreshold;
              return (
                <a
                  key={`${j.company}-${j.role}-${j.url}`}
                  href={j.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`relative block bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition no-underline ${isTop ? "ring-2 ring-purple-500/60" : ""}`}
                >
                  <div className={`absolute top-3 right-3 text-sm font-bold ${fitColor(j.fit)}`}>{j.fit.toFixed(1)}</div>
                  <div className="font-semibold text-base text-[#111827] pr-10">{j.company}</div>
                  <div className="text-sm text-[#111827]">{j.role}</div>
                  <div className="text-xs text-gray-500">{j.location}</div>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">{j.ats_source}</span>
                    {j.role_category && j.role_category !== "other" && (
                      <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">{j.role_category}</span>
                    )}
                    <span className="text-gray-400">{relativeDays(j.posted_date)}</span>
                  </div>
                  <div className="text-xs mt-3 text-gray-600">{j.why}</div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      addApplication(j.company, j.role);
                    }}
                    className="mt-4 text-xs px-3 py-1 border rounded-lg"
                    style={{ borderColor: "#7c3aed", color: "#7c3aed" }}
                  >
                    Add to tracker
                  </button>
                </a>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="bg-gray-50 py-6 text-center mt-8">
        <div className="text-sm uppercase tracking-wider text-gray-500">Roadmap — for startup operators, not just VC-track</div>
        <div className="text-base text-gray-700 mt-2 max-w-3xl mx-auto px-6">
          Today: tracker + insights + role-feed. Next: skill recommender (courses, events, Maven cohorts). Year-1: persistent Career-Buddy with multi-year memory — switch-timing, salary-negotiation, headhunter broker.
        </div>
      </footer>

      {showAdd && <AddAppModal onClose={() => setShowAdd(false)} onAdd={addApplication} />}

      {editProfileOpen && (
        <EditProfileModal
          profile={state.profile}
          onClose={() => setEditProfileOpen(false)}
          onSave={(next) => {
            setState((s) => ({ ...s, profile: { ...s.profile, ...next } }));
            setEditProfileOpen(false);
          }}
        />
      )}
    </div>
  );
}

const CANNED_REPLY =
  "Got it. Target: Founders Associate at AI-startups + Operating Associate / BizOps / Strategy roles at early-stage startups. Geo: Berlin / Remote-DACH. Background: business track, 0–2y experience. Edit your profile any time to refine the fit.";

function ProfileCard({
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

  if (collapsed) {
    return (
      <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg p-3 text-sm">
        <span>
          {profile.name || "Profile"} · {profile.target_role} · {profile.target_geo}
        </span>
        <div className="flex items-center gap-3">
          <button onClick={onEdit} className="text-xs underline" style={{ color: "#7c3aed" }}>
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

      {summary && <div className="mt-4 bg-gray-50 rounded-lg px-4 py-3 text-sm">{summary}</div>}
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
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
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

function EditProfileModal({
  profile,
  onClose,
  onSave,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (next: Partial<Profile>) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [headline, setHeadline] = useState(profile.headline);
  const [targetRole, setTargetRole] = useState(profile.target_role);
  const [targetGeo, setTargetGeo] = useState(profile.target_geo);
  const [background, setBackground] = useState(profile.background);
  const [strengths, setStrengths] = useState<string[]>(profile.strengths);
  const [gaps, setGaps] = useState<string[]>(profile.gaps);
  const [recommendations, setRecommendations] = useState<string[]>(profile.recommendations);
  const [categories, setCategories] = useState<string[]>(profile.target_role_categories);
  const [locationPrefs, setLocationPrefs] = useState<string[]>(profile.location_preferences);
  const [work, setWork] = useState<Position[]>(profile.work_history);
  const [education, setEducation] = useState<Education[]>(profile.education);

  function save() {
    onSave({
      name: name.trim(),
      headline: headline.trim(),
      target_role: targetRole.trim(),
      target_geo: targetGeo.trim(),
      background: background.trim(),
      strengths: strengths.map((s) => s.trim()).filter(Boolean),
      gaps: gaps.map((g) => g.trim()).filter(Boolean),
      recommendations: recommendations.map((r) => r.trim()).filter(Boolean),
      target_role_categories: categories,
      location_preferences: locationPrefs.map((l) => l.trim()).filter(Boolean),
      work_history: work
        .map((p) => ({
          ...p,
          company: p.company.trim(),
          role: p.role.trim(),
          start_date: p.start_date.trim(),
          end_date: p.end_date.trim(),
          bullets: p.bullets.map((b) => b.trim()).filter(Boolean),
        }))
        .filter((p) => p.company || p.role),
      education: education
        .map((e) => ({
          ...e,
          institution: e.institution.trim(),
          degree: e.degree.trim(),
        }))
        .filter((e) => e.institution || e.degree),
    });
  }

  function addPosition() {
    setWork((w) => [
      ...w,
      { id: `w${Date.now()}`, company: "", role: "", start_date: "", end_date: "Present", bullets: [""] },
    ]);
  }

  function addEducation() {
    setEducation((e) => [...e, { id: `e${Date.now()}`, institution: "", degree: "" }]);
  }

  function toggleCategory(cat: string) {
    setCategories((c) => (c.includes(cat) ? c.filter((x) => x !== cat) : [...c, cat]));
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Edit profile</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </Field>
            <Field label="Headline (one-line pitch)">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. CLSBE Master · B2B-sales · operator-in-training" />
            </Field>
            <Field label="Target role">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} />
            </Field>
            <Field label="Target geography">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={targetGeo} onChange={(e) => setTargetGeo(e.target.value)} />
            </Field>
            <Field label="Background" full>
              <textarea rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" value={background} onChange={(e) => setBackground(e.target.value)} />
            </Field>
          </div>

          <Field label="Target role categories (used for fit-score)">
            <div className="flex flex-wrap gap-2">
              {ROLE_CATEGORY_OPTIONS.map((cat) => {
                const on = categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-purple-600 border-purple-600 text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </Field>

          <BulletEditor label="Location preferences" items={locationPrefs} onChange={setLocationPrefs} placeholder="e.g. Berlin, Remote-DACH" />
          <BulletEditor label="Strengths" items={strengths} onChange={setStrengths} placeholder="One strength per line" />
          <BulletEditor label="Gaps" items={gaps} onChange={setGaps} placeholder="One gap per line" />
          <BulletEditor label="Recommendations" items={recommendations} onChange={setRecommendations} placeholder="One recommendation per line" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Work history</label>
              <button type="button" onClick={addPosition} className="text-xs text-purple-700 flex items-center gap-1 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add position
              </button>
            </div>
            <div className="space-y-3">
              {work.length === 0 && (
                <div className="text-xs text-gray-400 italic">No positions yet. Upload a CV or add one manually.</div>
              )}
              {work.map((p, idx) => (
                <PositionEditor
                  key={p.id}
                  position={p}
                  onChange={(np) =>
                    setWork((w) => w.map((x, i) => (i === idx ? np : x)))
                  }
                  onRemove={() => setWork((w) => w.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Education</label>
              <button type="button" onClick={addEducation} className="text-xs text-purple-700 flex items-center gap-1 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add education
              </button>
            </div>
            <div className="space-y-3">
              {education.length === 0 && (
                <div className="text-xs text-gray-400 italic">No education yet.</div>
              )}
              {education.map((e, idx) => (
                <div key={e.id} className="border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Institution"
                      value={e.institution}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, institution: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Degree"
                      value={e.degree}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, degree: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Start (YYYY-MM)"
                      value={e.start_date ?? ""}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, start_date: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="End (YYYY-MM or Present)"
                      value={e.end_date ?? ""}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, end_date: ev.target.value } : x)))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEducation((edu) => edu.filter((_, i) => i !== idx))}
                    className="text-xs text-red-600 flex items-center gap-1 hover:underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-end gap-2 bg-white rounded-b-xl sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm text-white rounded-lg" style={{ backgroundColor: "#7c3aed" }}>
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function BulletEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="text-xs text-purple-700 flex items-center gap-1 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <div className="text-xs text-gray-400 italic">No items.</div>}
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              placeholder={placeholder}
              value={it}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="px-2 text-gray-400 hover:text-red-600"
              aria-label="Remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionEditor({
  position,
  onChange,
  onRemove,
}: {
  position: Position;
  onChange: (p: Position) => void;
  onRemove: () => void;
}) {
  function setField<K extends keyof Position>(k: K, v: Position[K]) {
    onChange({ ...position, [k]: v });
  }
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Company" value={position.company} onChange={(e) => setField("company", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Role" value={position.role} onChange={(e) => setField("role", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Start (YYYY-MM)" value={position.start_date} onChange={(e) => setField("start_date", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="End (YYYY-MM or Present)" value={position.end_date} onChange={(e) => setField("end_date", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="Location (optional)" value={position.location ?? ""} onChange={(e) => setField("location", e.target.value)} />
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Bullets</div>
        <div className="space-y-2">
          {position.bullets.map((b, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                rows={2}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Achievement, e.g. 'Closed 14 B2B deals worth €450k ARR'"
                value={b}
                onChange={(e) =>
                  onChange({
                    ...position,
                    bullets: position.bullets.map((x, j) => (j === i ? e.target.value : x)),
                  })
                }
              />
              <button
                type="button"
                onClick={() => onChange({ ...position, bullets: position.bullets.filter((_, j) => j !== i) })}
                className="px-2 text-gray-400 hover:text-red-600 self-start mt-1"
                aria-label="Remove bullet"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...position, bullets: [...position.bullets, ""] })}
            className="text-xs text-purple-700 flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add bullet
          </button>
        </div>
      </div>
      <button type="button" onClick={onRemove} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
        <Trash2 className="w-3.5 h-3.5" /> Remove position
      </button>
    </div>
  );
}
