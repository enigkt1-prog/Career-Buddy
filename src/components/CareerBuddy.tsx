import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Loader2, Upload, Pencil, Plus, Trash2, X, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { extractCvText } from "@/lib/cv-parser";
import {
  buildProfileTokens,
  fitScore,
  fitWhy,
  profileYearsExperience,
  tokenize,
} from "@/lib/job-fit";
import {
  DEFAULT_FILTERS,
  applyFilters,
  countActiveFilters,
  parseFiltersFromHash,
  serializeFilters,
  sortJobs,
  type Filters,
  type SortKey,
} from "@/lib/job-filters";
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
  notes?: string;
  url?: string;
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
  dismissed_urls: string[];
};

// Filters / SortKey / DEFAULT_FILTERS now live in @/lib/job-filters
// (imported below). JobLevel type stays inline because it's referenced
// by the rich VcJob type that has a dozen other fields.

type MatchResult = {
  score: number;
  verdict: "strong" | "moderate" | "weak";
  matched_skills: string[];
  missing_skills: string[];
  experience_match: string;
  reasons: string[];
  blockers?: string[];
  suggestion: string;
};

type MatchEntry =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string; retryAfterMs?: number }
  | { status: "ready"; result: MatchResult; profile_signature: string; computed_at: number };

type DraftKind = "cover_letter" | "outreach" | "feedback_request" | "thank_you" | "follow_up";

type DraftResult = {
  subject: string;
  body: string;
  bullet_points_used?: string[];
};

const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  cover_letter: "Cover letter",
  outreach: "LinkedIn outreach",
  feedback_request: "Ask for feedback",
  thank_you: "Thank-you note",
  follow_up: "Follow-up nudge",
};

type JobLevel = "intern" | "junior" | "mid" | "senior" | "lead" | "principal" | "executive";

type VcJob = {
  company: string;
  role: string;
  role_category: string | null;
  location: string;
  url: string;
  ats_source: string;
  posted_date: string | null;
  is_remote: boolean;
  description: string | null;
  requirements: string | null;
  years_min: number | null;
  years_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  languages_required: string[];
  level: JobLevel | null;
  country: string | null;
  city: string | null;
  visa_sponsorship: boolean | null;
  is_international: boolean;
  jobTokens: Set<string>;
  reqTokens: Set<string>;
};

type ScoredJob = VcJob & { fit: number; why: string; matched: string[] };

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

const SEED_APPS: Application[] = [];

// fit + token helpers now live in src/lib/job-fit.ts (single source of
// truth shared with future /jobs filter UI). DACH_CITIES, STOPWORDS,
// TOKEN_RE, tokenize, profileYearsExperience, parseYearMonth,
// buildProfileTokens, tokensMatch, intersect — all imported below.

function emptyState(): State {
  return {
    applications: [],
    profile: { ...DEFAULT_PROFILE },
    sync_completed: false,
    dismissed_urls: [],
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
      dismissed_urls: Array.isArray((parsed as { dismissed_urls?: unknown }).dismissed_urls)
        ? ((parsed as { dismissed_urls: unknown[] }).dismissed_urls.filter((x) => typeof x === "string") as string[])
        : [],
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

function formatSalary(min: number, max: number | null, currency: string | null): string {
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "USD" ? "$" : "";
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (max !== null && max > min) return `${sym}${fmt(min)}–${fmt(max)}`;
  return `${sym}${fmt(min)}+`;
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

// fitScore moved to src/lib/job-fit.ts (imported below).

const FILTER_PRESETS_KEY = "career-buddy-filter-presets-v1";

type FilterPreset = { name: string; filters: Filters };

function loadPresets(): FilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FILTER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === "string" && p.filters) as FilterPreset[];
  } catch {
    return [];
  }
}

function persistPresets(presets: FilterPreset[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(presets));
  } catch {}
}

// serializeFilters / parseFiltersFromHash / sortJobs / countActiveFilters
// moved to src/lib/job-filters.ts (imported above).

function profileCompleteness(profile: Profile): { score: number; done: number; total: number } {
  const checks = [
    profile.name.trim(),
    profile.headline.trim(),
    profile.target_role.trim(),
    profile.target_geo.trim(),
    profile.background.trim(),
    profile.strengths.length > 0,
    profile.target_role_categories.length > 0,
    profile.location_preferences.length > 0,
    profile.cv_analyzed,
    profile.work_history.length > 0,
    profile.education.length > 0,
  ];
  const done = checks.filter(Boolean).length;
  return { score: Math.round((done / checks.length) * 100), done, total: checks.length };
}

function cleanSnippet(text: string | null): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

// applyFilters moved to src/lib/job-filters.ts (imported above).

function applicationToRow(a: Application): Record<string, unknown> {
  return {
    client_id: a.id,
    company: a.company,
    role: a.role,
    status: a.status,
    next_action: a.next_action,
    fit_score: a.fit,
    url: a.url ?? null,
    notes: a.notes ?? null,
    last_event_date: safeIsoDate(a.last_event),
  };
}

function safeIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).toISOString();
  return null;
}

function profileSignature(p: Profile): string {
  // Stable signature: changes when fitness-affecting fields change.
  const parts = [
    p.target_role,
    p.target_geo,
    p.background,
    p.headline,
    [...p.strengths].sort().join("|"),
    [...p.target_role_categories].sort().join("|"),
    [...p.location_preferences].sort().join("|"),
    p.work_history.map((w) => `${w.company}-${w.role}-${w.bullets.join(";")}`).join("||"),
  ];
  // Cheap deterministic hash (FNV-1a-ish, sufficient for cache-key collision avoidance).
  const blob = parts.join("\n");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < blob.length; i++) {
    h ^= blob.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

const MATCH_CACHE_KEY = "career-buddy-matches-v1";
const MATCH_QUOTA_KEY = "career-buddy-match-quota-v1";
const MATCH_QUOTA_COOLDOWN_MS = 4 * 3600 * 1000;
const MATCH_DAILY_LIMIT = 10;

type MatchCache = Record<string, { result: MatchResult; profile_signature: string; computed_at: number }>;

function loadMatchCache(): MatchCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MATCH_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as MatchCache;
  } catch {
    return {};
  }
}

function persistMatchCache(cache: MatchCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function readQuotaState(): { quotaHitAt: number | null; runs: { date: string; count: number } } {
  if (typeof window === "undefined") return { quotaHitAt: null, runs: { date: "", count: 0 } };
  try {
    const raw = localStorage.getItem(MATCH_QUOTA_KEY);
    if (!raw) return { quotaHitAt: null, runs: { date: "", count: 0 } };
    return JSON.parse(raw);
  } catch {
    return { quotaHitAt: null, runs: { date: "", count: 0 } };
  }
}

function writeQuotaState(state: { quotaHitAt: number | null; runs: { date: string; count: number } }) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MATCH_QUOTA_KEY, JSON.stringify(state));
  } catch {}
}

// fitWhy moved to src/lib/job-fit.ts (imported below).

type CareerBuddyProps = {
  /** Render only the roles grid + filters; hide profile, tracker, CV. */
  rolesOnly?: boolean;
};

export default function CareerBuddy({ rolesOnly = false }: CareerBuddyProps = {}) {
  const [state, setState] = useState<State>(emptyState);
  const [hydrated, setHydrated] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [cvText, setCvText] = useState("");
  const [cvLoading, setCvLoading] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [cvFilename, setCvFilename] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [jobs, setJobs] = useState<VcJob[]>([]);
  const [insightsShimmer, setInsightsShimmer] = useState(false);
  const [matches, setMatches] = useState<Record<string, MatchEntry>>({});
  const [matchQuotaHit, setMatchQuotaHit] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [draftJobUrl, setDraftJobUrl] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null);
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  // Hydrate browser-only caches after mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    setState(loadState());
    const cache = loadMatchCache();
    const out: Record<string, MatchEntry> = {};
    for (const [k, v] of Object.entries(cache)) {
      out[k] = { status: "ready", result: v.result, profile_signature: v.profile_signature, computed_at: v.computed_at };
    }
    setMatches(out);
    const q = readQuotaState();
    if (q.quotaHitAt && Date.now() - q.quotaHitAt <= MATCH_QUOTA_COOLDOWN_MS) {
      setMatchQuotaHit(q.quotaHitAt);
    }
    setHydrated(true);
  }, []);

  // Hydrate filters from URL hash on mount; sync on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setFilters(parseFiltersFromHash(window.location.hash));
    setFiltersHydrated(true);
    setPresets(loadPresets());
    function onHashChange() {
      setFilters(parseFiltersFromHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function saveCurrentAsPreset() {
    const name = window.prompt("Name this filter preset:");
    if (!name || !name.trim()) return;
    const next = [...presets.filter((p) => p.name !== name.trim()), { name: name.trim(), filters }];
    setPresets(next);
    persistPresets(next);
  }
  function applyPreset(p: FilterPreset) {
    setFilters({ ...DEFAULT_FILTERS, ...p.filters });
  }
  function deletePreset(name: string) {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    persistPresets(next);
  }

  useEffect(() => {
    if (!filtersHydrated) return;
    if (typeof window === "undefined") return;
    const next = serializeFilters(filters);
    const target = next ? `#${next}` : "";
    if (window.location.hash !== target) {
      // Avoid stacking history entries for incremental filter changes.
      const newUrl = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(null, "", newUrl);
    }
  }, [filters, filtersHydrated]);

  const dismissedSet = useMemo(() => new Set(state.dismissed_urls), [state.dismissed_urls]);

  function dismissJob(url: string) {
    setState((s) => (s.dismissed_urls.includes(url) ? s : { ...s, dismissed_urls: [...s.dismissed_urls, url] }));
    void supabase
      .from("job_dismissals")
      .upsert({ url }, { onConflict: "url" })
      .then(({ error }) => {
        if (error) console.error("[job_dismissals] upsert failed", error);
      });
  }
  function undoDismiss(url: string) {
    setState((s) => ({ ...s, dismissed_urls: s.dismissed_urls.filter((u) => u !== url) }));
    void supabase
      .from("job_dismissals")
      .delete()
      .eq("url", url)
      .then(({ error }) => {
        if (error) console.error("[job_dismissals] delete failed", error);
      });
  }
  function clearDismissed() {
    const urls = state.dismissed_urls;
    setState((s) => ({ ...s, dismissed_urls: [] }));
    if (urls.length > 0) {
      void supabase
        .from("job_dismissals")
        .delete()
        .in("url", urls)
        .then(({ error }) => {
          if (error) console.error("[job_dismissals] clear failed", error);
        });
    }
  }

  useEffect(() => {
    if (hydrated && state.profile.built) setChatReply(CANNED_REPLY);
  }, [hydrated, state.profile.built]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  useEffect(() => {
    // Hydrate applications from Supabase (single-user, no auth).
    void (async () => {
      const { data: appRows, error: appErr } = await supabase
        .from("applications")
        .select("client_id, company, role, status, next_action, fit_score, url, notes, last_event_date")
        .not("client_id", "is", null);
      if (appErr) {
        console.warn("[applications] fetch failed", appErr.message);
        return;
      }
      type AppRow = {
        client_id: string;
        company: string;
        role: string | null;
        status: string | null;
        next_action: string | null;
        fit_score: number | null;
        url: string | null;
        notes: string | null;
        last_event_date: string | null;
      };
      const remote: Application[] = (appRows ?? [])
        .filter((r): r is AppRow => !!r && typeof r.client_id === "string")
        .map((r) => ({
          id: r.client_id,
          company: r.company,
          role: r.role ?? "",
          status: (r.status ?? "applied") as Status,
          last_event: r.last_event_date ? r.last_event_date.slice(0, 10) : "—",
          next_action: r.next_action ?? "",
          fit: typeof r.fit_score === "number" ? r.fit_score : 7.0,
          url: r.url ?? undefined,
          notes: r.notes ?? undefined,
        }));
      if (remote.length > 0) {
        setState((s) => {
          // Merge: any localStorage app whose id isn't on the server stays (will be synced on next mutation).
          const remoteIds = new Set(remote.map((r) => r.id));
          const localOnly = s.applications.filter((a) => !remoteIds.has(a.id));
          return { ...s, applications: [...remote, ...localOnly] };
        });
      }
    })();
    void (async () => {
      const { data: dismissedRows, error: dismissedError } = await supabase
        .from("job_dismissals")
        .select("url");
      if (dismissedError) {
        console.error("[job_dismissals] fetch failed", dismissedError);
      } else {
        const urls = (dismissedRows ?? []).map((r) => r.url).filter(Boolean);
        setState((s) => {
          const merged = Array.from(new Set([...s.dismissed_urls, ...urls]));
          return merged.length === s.dismissed_urls.length ? s : { ...s, dismissed_urls: merged };
        });
      }

      // Overview shows top-N picks (60-row fetch is plenty); /jobs needs
      // the full filterable feed across all 9,980 active jobs so older
      // postings (e.g. founders-associate, internships) actually surface
      // in filter results. 10,000 is a safe ceiling well above current
      // jobs.is_active count. Phase 3 will replace with server-side
      // pagination + GIN search to keep the payload under 10MB.
      const fetchLimit = rolesOnly ? 10000 : 60;
      // Supabase PostgREST default cap is 1000 rows per request — `.limit`
      // cannot bypass it. `.range(0, fetchLimit - 1)` explicitly requests
      // the wider window. Description + requirements stay in the column
      // list because the UI shows excerpts; if payload becomes a problem
      // (Phase 3) we lazy-load those two on card expand.
      const { data, error } = await supabase
        .from("jobs")
        .select("company_name, role_title, role_category, location, url, ats_source, posted_date, is_remote, description, requirements, years_min, years_max, salary_min, salary_max, salary_currency, languages_required, level, country, city, visa_sponsorship, is_international")
        .eq("is_active", true)
        .order("posted_date", { ascending: false, nullsFirst: false })
        .range(0, fetchLimit - 1);
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
        description: string | null;
        requirements: string | null;
        years_min: number | null;
        years_max: number | null;
        salary_min: number | null;
        salary_max: number | null;
        salary_currency: string | null;
        languages_required: string[] | null;
        level: JobLevel | null;
        country: string | null;
        city: string | null;
        visa_sponsorship: boolean | null;
        is_international: boolean | null;
      }>;
      setJobs(
        rows.map((r) => {
          const desc = (r.description ?? "").slice(0, 4000);
          const reqs = (r.requirements ?? "").slice(0, 2000);
          return {
            company: r.company_name,
            role: r.role_title,
            role_category: r.role_category,
            location: r.location ?? "—",
            url: r.url,
            ats_source: r.ats_source,
            posted_date: r.posted_date,
            is_remote: r.is_remote === true,
            description: r.description,
            requirements: r.requirements,
            years_min: r.years_min,
            years_max: r.years_max,
            salary_min: r.salary_min,
            salary_max: r.salary_max,
            salary_currency: r.salary_currency,
            languages_required: r.languages_required ?? [],
            level: r.level,
            country: r.country,
            city: r.city,
            visa_sponsorship: r.visa_sponsorship,
            is_international: r.is_international === true,
            jobTokens: tokenize(`${r.role_title} ${desc}`),
            reqTokens: tokenize(reqs),
          };
        }),
      );
    })();
  }, []);

  function buildProfile() {
    if (!chatInput.trim()) return;
    setChatLoading(true);
    const text = chatInput.trim();
    // Heuristic seed: extract obvious cues from the chat input.
    const lower = text.toLowerCase();
    const guessGeo =
      /berlin/i.test(text) ? "Berlin / Remote-DACH"
      : /munich|münchen/i.test(text) ? "Munich / Remote-DACH"
      : /london/i.test(text) ? "London / Remote-EU"
      : /remote/i.test(text) ? "Remote"
      : "";
    const guessRole =
      /founder|founder.s associate|fa\b/i.test(lower) ? "Founders Associate"
      : /biz ?ops|operating associate/i.test(lower) ? "BizOps / Operating Associate"
      : /chief of staff|cos\b/i.test(lower) ? "Chief of Staff"
      : /strategy/i.test(lower) ? "Strategy Associate"
      : /investment|venture|vc\b/i.test(lower) ? "Investment Analyst"
      : /\bbd\b|business development|partnerships/i.test(lower) ? "Business Development"
      : "";
    setTimeout(() => {
      setChatLoading(false);
      setChatReply(CANNED_REPLY);
      setState((s) => ({
        ...s,
        profile: {
          ...s.profile,
          built: true,
          collapsed: false,
          headline: s.profile.headline || text.slice(0, 140),
          target_role: guessRole || s.profile.target_role,
          target_geo: guessGeo || s.profile.target_geo,
        },
      }));
      // Open the editor so the user can refine immediately.
      setEditProfileOpen(true);
    }, 400);
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

  function syncApp(a: Application) {
    void supabase
      .from("applications")
      .upsert(applicationToRow(a), { onConflict: "client_id" })
      .then(({ error }) => {
        if (error) console.warn("[applications] upsert failed", error.message);
      });
  }

  function addApplication(company: string, role: string, opts?: { url?: string; fit?: number }) {
    if (state.applications.some((a) => a.company === company && a.role === role)) {
      return;
    }
    const newApp: Application = {
      id: `a${Date.now()}`,
      company,
      role,
      status: "applied",
      last_event: todayISO(),
      next_action: "Awaiting reply",
      fit: opts?.fit ?? 7.0,
      url: opts?.url,
    };
    setState((s) => ({ ...s, applications: [...s.applications, newApp] }));
    syncApp(newApp);
  }

  function updateApplication(id: string, patch: Partial<Application>) {
    setState((s) => {
      const next = s.applications.map((a) => (a.id === id ? { ...a, ...patch } : a));
      const updated = next.find((a) => a.id === id);
      if (updated) syncApp(updated);
      return { ...s, applications: next };
    });
  }

  function deleteApplication(id: string) {
    setState((s) => ({ ...s, applications: s.applications.filter((a) => a.id !== id) }));
    void supabase
      .from("applications")
      .delete()
      .eq("client_id", id)
      .then(({ error }) => {
        if (error) console.warn("[applications] delete failed", error.message);
      });
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

  const profTokens = useMemo(() => buildProfileTokens(state.profile), [state.profile]);
  const profYears = useMemo(() => profileYearsExperience(state.profile), [state.profile]);
  const profSig = useMemo(() => profileSignature(state.profile), [state.profile]);

  // When profile signature changes, drop in-memory matches that were graded
  // against the old signature. Otherwise stale chips keep rendering on JobCard
  // until the user reloads.
  useEffect(() => {
    if (!hydrated) return;
    setMatches((m) => {
      let dirty = false;
      const next: Record<string, MatchEntry> = {};
      for (const [k, v] of Object.entries(m)) {
        if (v.status === "ready" && v.profile_signature !== profSig) {
          dirty = true;
          continue;
        }
        next[k] = v;
      }
      return dirty ? next : m;
    });
  }, [profSig, hydrated]);

  // Persist match cache; evict entries whose profile_signature no longer matches.
  useEffect(() => {
    if (!hydrated) return;
    const cache: MatchCache = {};
    for (const [k, v] of Object.entries(matches)) {
      if (v.status === "ready" && v.profile_signature === profSig) {
        cache[k] = { result: v.result, profile_signature: v.profile_signature, computed_at: v.computed_at };
      }
    }
    persistMatchCache(cache);
  }, [matches, profSig, hydrated]);

  // Count requests-attempted-today, not just successful matches. Errors and
  // in-flight calls also burn quota.
  const matchesUsedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const v of Object.values(matches)) {
      if (v.status === "loading") {
        n++;
      } else if (v.status === "ready" && v.computed_at && new Date(v.computed_at).toISOString().slice(0, 10) === today) {
        n++;
      } else if (v.status === "error") {
        n++;
      }
    }
    return n;
  }, [matches]);

  // Sequential queue: only one in-flight match-job request at a time.
  const matchQueueRef = useRef<Array<{ key: string; job: VcJob }>>([]);
  const matchInFlightRef = useRef(false);
  const cvFileInputRef = useRef<HTMLInputElement | null>(null);

  async function runOne(key: string, job: VcJob) {
    setMatches((m) => ({ ...m, [key]: { status: "loading" } }));
    try {
      const { data, error } = await supabase.functions.invoke("match-job", {
        body: {
          profile: {
            name: state.profile.name,
            headline: state.profile.headline,
            target_role: state.profile.target_role,
            target_geo: state.profile.target_geo,
            background: state.profile.background,
            strengths: state.profile.strengths,
            work_history: state.profile.work_history,
            education: state.profile.education,
          },
          job: {
            company: job.company,
            role: job.role,
            location: job.location,
            description: job.description ?? "",
            requirements: job.requirements ?? "",
          },
        },
      });
      if (error) {
        // supabase-js wraps non-2xx as FunctionsHttpError with .context.status.
        const status = (error as { context?: { status?: number } })?.context?.status;
        if (status === 429) {
          tripQuotaCooldown();
        }
        throw error;
      }
      const payload = data as { match?: MatchResult; error?: string };
      if (!payload?.match) {
        const errMsg = payload?.error || "No match returned";
        if (/quota/i.test(errMsg)) tripQuotaCooldown();
        throw new Error(errMsg);
      }
      setMatches((m) => ({
        ...m,
        [key]: { status: "ready", result: payload.match!, profile_signature: profSig, computed_at: Date.now() },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Match failed";
      // Some supabase-js error paths surface 429 only via the thrown error's message.
      if (/(?:^|\s)429(?:\s|$)|quota/i.test(msg)) tripQuotaCooldown();
      setMatches((m) => ({ ...m, [key]: { status: "error", error: msg } }));
    }
  }

  function tripQuotaCooldown() {
    const now = Date.now();
    setMatchQuotaHit(now);
    writeQuotaState({
      quotaHitAt: now,
      runs: { date: new Date().toISOString().slice(0, 10), count: 0 },
    });
  }

  async function pumpMatchQueue() {
    if (matchInFlightRef.current) return;
    const next = matchQueueRef.current.shift();
    if (!next) return;
    matchInFlightRef.current = true;
    try {
      await runOne(next.key, next.job);
    } finally {
      matchInFlightRef.current = false;
      // Continue draining the queue.
      void pumpMatchQueue();
    }
  }

  function requestMatch(job: VcJob) {
    const key = job.url;
    const existing = matches[key];
    if (existing && (existing.status === "loading" || existing.status === "ready")) return;
    if (matchQuotaHit && Date.now() - matchQuotaHit < MATCH_QUOTA_COOLDOWN_MS) return;
    if (matchesUsedToday >= MATCH_DAILY_LIMIT) return;
    if (!job.description && !job.requirements) {
      setMatches((m) => ({ ...m, [key]: { status: "error", error: "Job has no description to analyse." } }));
      return;
    }
    matchQueueRef.current.push({ key, job });
    void pumpMatchQueue();
  }

  const filteredJobs = useMemo(() => applyFilters(jobs, filters, dismissedSet), [jobs, filters, dismissedSet]);

  const rankedJobs: ScoredJob[] = useMemo(() => {
    return filteredJobs
      .map((j) => {
        const { score, matched } = fitScore(j, state.profile, profTokens, profYears);
        return {
          ...j,
          fit: score,
          matched,
          why: fitWhy(j, state.profile, matched),
        };
      })
      .sort((a, b) => sortJobs(a, b, filters.sort))
      .slice(0, 30);
  }, [filteredJobs, state.profile, profTokens, profYears, filters.sort]);

  const topThreshold = rankedJobs[2]?.fit ?? 0;

  return (
    <div className="min-h-screen bg-cinema-cream text-cinema-ink" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <main className="max-w-6xl mx-auto px-6">
        {!rolesOnly && (<>
        <section id="profile" className="py-8 scroll-mt-16">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Land your first startup role.</h1>
          <p className="text-base text-gray-500 mb-3">
            {jobs.length} live roles · powered by Gemini ·{" "}
            <button onClick={resetDemo} className="underline hover:text-gray-700">Reset local data</button>
          </p>
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
                style={{ backgroundColor: "#1c2620" }}
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

          {/* CV upload — always visible (Phase 0.5: was previously gated
              on profile.built, which silently hid it for first-time users).
              Switched from <label>-wrap to button + ref + .click() to avoid
              Safari quirks where label-wrapped hidden file inputs sometimes
              fail to open the OS file picker. */}
          <div id="cv-upload" className="bg-white border rounded-xl shadow-sm p-5 scroll-mt-16">
              <label className="text-sm font-medium block mb-2">Upload or paste your CV</label>
              <div className="flex items-center gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => cvFileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg cursor-pointer hover:bg-gray-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload .pdf / .docx / .txt</span>
                </button>
                <input
                  ref={cvFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    // Reset so the same file can be re-selected after error.
                    e.target.value = "";
                  }}
                />
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
                  style={{ backgroundColor: "#1c2620" }}
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
        </section>

        <section id="tracker" className="py-8 grid grid-cols-1 md:grid-cols-3 gap-6 scroll-mt-16">
          <div className="md:col-span-2">
            <ApplicationsTracker
              applications={state.applications}
              onAdd={() => setShowAdd(true)}
              onUpdate={updateApplication}
              onDelete={deleteApplication}
            />
          </div>
          <div className="md:col-span-1">
            <div className="md:sticky md:top-20">
              <InsightsPanel
                shimmer={insightsShimmer}
                onRefresh={refreshInsights}
                applications={state.applications}
                jobs={jobs}
                profile={state.profile}
                rankedJobs={rankedJobs}
              />
            </div>
          </div>
        </section>
        </>)}

        <section id="roles" className="py-8 scroll-mt-16">
          <h2 className="text-2xl font-semibold mb-1">{rolesOnly ? "All live operator-track roles" : "Roles you might fit"}</h2>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <p className="text-sm text-gray-500">
              {jobs.length === 0
                ? "Loading live openings…"
                : rolesOnly
                ? `Showing ${rankedJobs.length} of ${jobs.length} live openings, ranked by profile + CV.`
                : `Top 6 picks for you out of ${jobs.length} live openings. `}
              {!rolesOnly && jobs.length > 0 && (
                <a href="/jobs" className="underline text-cinema-pine hover:text-cinema-moss font-medium">
                  See the full feed →
                </a>
              )}
            </p>
            <div className="flex items-center gap-3 text-xs">
              {state.dismissed_urls.length > 0 && (
                <button onClick={clearDismissed} className="text-gray-500 underline hover:text-gray-700">
                  show {state.dismissed_urls.length} dismissed
                </button>
              )}
              <select
                value={filters.sort}
                onChange={(e) => setFilters({ ...filters, sort: e.target.value as SortKey })}
                className="border rounded-lg px-2 py-1.5 bg-white text-gray-700"
              >
                <option value="fit">Sort: best fit</option>
                <option value="recency">Sort: most recent</option>
                <option value="years_asc">Sort: fewest years required</option>
                <option value="salary_desc">Sort: highest salary</option>
                <option value="company">Sort: company A→Z</option>
              </select>
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                className="px-3 py-1.5 border rounded-lg flex items-center gap-1 text-gray-700 hover:bg-gray-50"
              >
                Filters
                {countActiveFilters(filters) > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-cinema-moss text-white">
                    {countActiveFilters(filters)}
                  </span>
                )}
                {filtersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          {filtersOpen && (
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
              jobs={jobs}
              presets={presets}
              onSavePreset={saveCurrentAsPreset}
              onApplyPreset={applyPreset}
              onDeletePreset={deletePreset}
            />
          )}
          {matchQuotaHit && Date.now() - matchQuotaHit < MATCH_QUOTA_COOLDOWN_MS && (
            <div className="mb-4 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              AI fit-analysis paused — Gemini free quota hit. Resuming around midnight Pacific time.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(rolesOnly ? rankedJobs : rankedJobs.slice(0, 6)).map((j, idx) => {
              const isTop = idx < 3 && j.fit >= 7.0 && j.fit >= topThreshold;
              const matchEntry = matches[j.url];
              const matchDisabled = !!(matchQuotaHit && Date.now() - matchQuotaHit < MATCH_QUOTA_COOLDOWN_MS) || matchesUsedToday >= MATCH_DAILY_LIMIT;
              return (
                <JobCard
                  key={`${j.company}-${j.role}-${j.url}`}
                  job={j}
                  isTop={isTop}
                  matchEntry={matchEntry}
                  matchDisabled={matchDisabled}
                  onAnalyze={() => requestMatch(j)}
                  onAdd={() => addApplication(j.company, j.role, { url: j.url, fit: j.fit })}
                  onDismiss={() => dismissJob(j.url)}
                  onDraft={() => {
                    setDraftJobUrl(j.url);
                    setDraftKind("cover_letter");
                  }}
                />
              );
            })}
          </div>
          {state.profile.cv_analyzed && rankedJobs.length > 0 && (
            <div className="mt-4 text-xs text-gray-500">
              AI fit-analysis used today: {matchesUsedToday}/{MATCH_DAILY_LIMIT}
            </div>
          )}
          {draftJobUrl && draftKind && (
            <DraftModal
              profile={state.profile}
              job={(rankedJobs.find((r) => r.url === draftJobUrl) ?? jobs.find((j) => j.url === draftJobUrl)) as VcJob | undefined}
              kind={draftKind}
              onClose={() => {
                setDraftJobUrl(null);
                setDraftKind(null);
              }}
            />
          )}
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

const STATUS_OPTIONS: Status[] = [
  "applied",
  "interview-1",
  "interview-2",
  "follow-up-needed",
  "offer",
  "rejected",
  "confirmation",
];

function ApplicationsTracker({
  applications,
  onAdd,
  onUpdate,
  onDelete,
}: {
  applications: Application[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Application>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Applications</h2>
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:shadow-md"
            style={{ backgroundColor: "#1c2620" }}
          >
            + Add Application
          </button>
        </div>
      </div>

      {applications.length === 0 && (
        <div className="text-sm text-gray-500 italic py-6 text-center border border-dashed rounded-lg">
          No applications yet. Click <span className="font-medium text-gray-700">"Add to tracker"</span> on a role card below, or{" "}
          <button onClick={onAdd} className="text-cinema-pine underline">add one manually</button>.
        </div>
      )}

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
              <th className="text-left py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <ApplicationRow key={a.id} app={a} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function ApplicationRow({
  app,
  onUpdate,
  onDelete,
}: {
  app: Application;
  onUpdate: (id: string, patch: Partial<Application>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingNext, setEditingNext] = useState(false);
  const [draftNext, setDraftNext] = useState(app.next_action);
  const [notesOpen, setNotesOpen] = useState(false);
  const [draftNotes, setDraftNotes] = useState(app.notes ?? "");

  function saveNext() {
    setEditingNext(false);
    if (draftNext.trim() !== app.next_action) {
      onUpdate(app.id, { next_action: draftNext.trim() });
    }
  }

  function saveNotes() {
    if (draftNotes.trim() !== (app.notes ?? "").trim()) {
      onUpdate(app.id, { notes: draftNotes.trim() || undefined });
    }
    setNotesOpen(false);
  }

  return (
    <>
      <tr
        className={`border-b transition-colors ease-out group ${app.flash ? "bg-cinema-mint/60" : ""}`}
        style={{ transitionDuration: "400ms" }}
      >
        <td className="py-2 px-2 font-medium">
          {app.url ? (
            <a href={app.url} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-cinema-sage">
              {app.company}
            </a>
          ) : (
            app.company
          )}
        </td>
        <td className="py-2 px-2">{app.role}</td>
        <td className="py-2 px-2">
          <select
            value={app.status}
            onChange={(e) => onUpdate(app.id, { status: e.target.value as Status, last_event: todayISO() })}
            className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-1 focus:ring-cinema-sage outline-none ${statusBadge(app.status)}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </td>
        <td className="py-2 px-2 text-gray-600">{app.last_event}</td>
        <td className="py-2 px-2 max-w-xs">
          {editingNext ? (
            <input
              autoFocus
              value={draftNext}
              onChange={(e) => setDraftNext(e.target.value)}
              onBlur={saveNext}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNext();
                if (e.key === "Escape") {
                  setDraftNext(app.next_action);
                  setEditingNext(false);
                }
              }}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          ) : (
            <button
              onClick={() => {
                setDraftNext(app.next_action);
                setEditingNext(true);
              }}
              className="text-left w-full hover:bg-gray-50 px-1 py-0.5 rounded"
              title="Click to edit"
            >
              {app.next_action}
            </button>
          )}
        </td>
        <td className={`py-2 px-2 font-semibold ${fitColor(app.fit)}`}>{app.fit.toFixed(1)}</td>
        <td className="py-2 px-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setDraftNotes(app.notes ?? "");
                setNotesOpen((o) => !o);
              }}
              className={`text-xs px-1.5 py-0.5 rounded ${app.notes ? "text-cinema-pine" : "text-gray-300 opacity-0 group-hover:opacity-100"} hover:bg-gray-100 transition`}
              title={app.notes ? "Edit notes" : "Add notes"}
            >
              {app.notes ? "📝" : "+"}
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Remove ${app.company} from tracker?`)) onDelete(app.id);
              }}
              className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              aria-label="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {notesOpen && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="py-2 px-2">
            <textarea
              autoFocus
              rows={3}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              onBlur={saveNotes}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraftNotes(app.notes ?? "");
                  setNotesOpen(false);
                }
              }}
              placeholder="Notes — e.g. 'Spoke with Anna on Thu, follow up Monday with B2B deal example.'"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            />
            <div className="text-[10px] text-gray-400 mt-1">Click outside to save · Esc to cancel</div>
          </td>
        </tr>
      )}
    </>
  );
}

function InsightsPanel({
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

function AddAppModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (company: string, role: string, opts?: { url?: string; fit?: number }) => void;
}) {
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
      onAdd(company.trim(), role.trim(), { url: url.trim() || undefined });
      setLoading(false);
      onClose();
    }, 300);
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
            style={{ backgroundColor: "#1c2620" }}
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
                    className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
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
              <button type="button" onClick={addPosition} className="text-xs text-cinema-pine flex items-center gap-1 hover:underline">
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
              <button type="button" onClick={addEducation} className="text-xs text-cinema-pine flex items-center gap-1 hover:underline">
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
          <button onClick={save} className="px-4 py-2 text-sm text-white rounded-lg" style={{ backgroundColor: "#1c2620" }}>
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
          className="text-xs text-cinema-pine flex items-center gap-1 hover:underline"
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
            className="text-xs text-cinema-pine flex items-center gap-1 hover:underline"
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

function JobCard({
  job,
  isTop,
  matchEntry,
  matchDisabled,
  onAnalyze,
  onAdd,
  onDismiss,
  onDraft,
}: {
  job: ScoredJob;
  isTop: boolean;
  matchEntry: MatchEntry | undefined;
  matchDisabled: boolean;
  onAnalyze: () => void;
  onAdd: () => void;
  onDismiss: () => void;
  onDraft: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);
  const status = matchEntry?.status ?? "idle";
  const isReady = status === "ready";
  const result = isReady ? (matchEntry as { result: MatchResult }).result : null;
  const showPanel = expanded && (status === "ready" || status === "loading" || status === "error");
  const snippet = cleanSnippet(job.description);

  return (
    <div
      className={`relative bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition ${isTop ? "ring-2 ring-cinema-sage/60" : ""}`}
      onMouseEnter={() => setShowSnippet(true)}
      onMouseLeave={() => setShowSnippet(false)}
    >
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Hide this job"
          className="text-gray-300 hover:text-gray-600 p-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <div className={`text-sm font-bold ${fitColor(job.fit)}`}>{job.fit.toFixed(1)}</div>
      </div>
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block no-underline text-[#111827] hover:underline decoration-cinema-sage"
      >
        <div className="font-semibold text-base pr-10">{job.company}</div>
        <div className="text-sm">{job.role}</div>
        <div className="text-xs text-gray-500 no-underline">{job.location}</div>
      </a>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px]">
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">{job.ats_source}</span>
        {job.role_category && job.role_category !== "other" && (
          <span className="px-2 py-0.5 rounded-full bg-cinema-mint/40 text-cinema-pine">{job.role_category}</span>
        )}
        {job.level && (
          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{job.level}</span>
        )}
        {job.years_min !== null && (
          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
            {job.years_max !== null ? `${job.years_min}–${job.years_max}y` : `${job.years_min}+y`}
          </span>
        )}
        {job.salary_min !== null && (
          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700">
            {formatSalary(job.salary_min, job.salary_max, job.salary_currency)}
          </span>
        )}
        {job.visa_sponsorship === true && (
          <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700">visa OK</span>
        )}
        {job.is_international && (
          <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700">multi-country</span>
        )}
        {job.languages_required.slice(0, 2).map((l) => (
          <span key={l} className="px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">{l}</span>
        ))}
        <span className="text-gray-400">{relativeDays(job.posted_date)}</span>
      </div>
      <div className="text-xs mt-3 text-gray-600">{job.why}</div>
      {showSnippet && snippet && (
        <div className="pointer-events-none absolute left-4 right-4 top-24 z-30 rounded-lg border bg-white p-3 text-[11px] leading-relaxed text-gray-600 shadow-lg">
          {snippet}
          {job.description && job.description.length > snippet.length ? "..." : ""}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={onAdd}
          className="text-xs px-3 py-1 border rounded-lg"
          style={{ borderColor: "#1c2620", color: "#1c2620" }}
        >
          Add to tracker
        </button>
        <button
          onClick={onDraft}
          className="text-xs px-3 py-1 border rounded-lg flex items-center gap-1 text-gray-700 hover:bg-gray-50"
          title="Draft a cover letter for this role"
        >
          ✍️ Draft
        </button>
        {status === "idle" && (
          <button
            onClick={() => {
              onAnalyze();
              setExpanded(true);
            }}
            disabled={matchDisabled}
            className="text-xs px-3 py-1 rounded-lg flex items-center gap-1 bg-cinema-moss text-white hover:bg-cinema-pine disabled:opacity-50 disabled:cursor-not-allowed"
            title={matchDisabled ? "AI quota for today reached" : "Run an AI fit analysis"}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Analyze fit
          </button>
        )}
        {(status === "ready" || status === "loading" || status === "error") && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs px-3 py-1 rounded-lg flex items-center gap-1 border border-cinema-sage/50 text-cinema-pine hover:bg-cinema-mint/40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {status === "loading" ? "Analyzing…" : status === "error" ? "Match failed — view" : `AI score ${result!.score.toFixed(1)}`}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {showPanel && (
        <div className="mt-3 border-t pt-3 text-xs space-y-2">
          {status === "loading" && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Asking Gemini…
            </div>
          )}
          {status === "error" && matchEntry?.status === "error" && (
            <div className="text-red-600">{matchEntry.error}</div>
          )}
          {status === "ready" && result && (
            <>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${fitColor(result.score)}`}>{result.score.toFixed(1)}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                  result.verdict === "strong" ? "bg-green-100 text-green-700"
                    : result.verdict === "moderate" ? "bg-yellow-100 text-yellow-700"
                    : "bg-red-100 text-red-700"
                }`}>{result.verdict}</span>
                <span className="text-gray-500">{result.experience_match}</span>
              </div>
              {result.reasons.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Why</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-gray-700">
                    {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {result.matched_skills.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Matched</div>
                  <div className="flex flex-wrap gap-1">
                    {result.matched_skills.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-green-50 text-green-700">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.missing_skills.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Missing</div>
                  <div className="flex flex-wrap gap-1">
                    {result.missing_skills.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-red-50 text-red-700">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {result.blockers && result.blockers.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Blockers</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-red-700">
                    {result.blockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}
              {result.suggestion && (
                <div className="text-gray-700 italic">→ {result.suggestion}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  onReset,
  jobs,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
  jobs: VcJob[];
  presets: FilterPreset[];
  onSavePreset: () => void;
  onApplyPreset: (p: FilterPreset) => void;
  onDeletePreset: (name: string) => void;
}) {
  const atsCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) m.set(j.ats_source, (m.get(j.ats_source) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      if (j.role_category) m.set(j.role_category, (m.get(j.role_category) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      if (j.country) m.set(j.country, (m.get(j.country) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [jobs]);

  const levelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      if (j.level) m.set(j.level, (m.get(j.level) ?? 0) + 1);
    }
    return m;
  }, [jobs]);

  function toggleArr(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  return (
    <div className="border rounded-xl bg-gray-50 p-4 mb-4 space-y-4">
      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Role category</div>
        <div className="flex flex-wrap gap-2">
          {ROLE_CATEGORY_OPTIONS.map((cat) => {
            const on = filters.roleCats.includes(cat);
            const count = catCounts.find(([c]) => c === cat)?.[1] ?? 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => onChange({ ...filters, roleCats: toggleArr(filters.roleCats, cat) })}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
              >
                {cat} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Location contains</div>
          <input
            type="text"
            placeholder="e.g. Berlin, Remote"
            value={filters.locationQuery}
            onChange={(e) => onChange({ ...filters, locationQuery: e.target.value })}
            className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
          />
        </div>
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Posted</div>
          <select
            value={filters.postedSince}
            onChange={(e) => onChange({ ...filters, postedSince: e.target.value as Filters["postedSince"] })}
            className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="any">Any time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Remote</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-1 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={filters.remoteOnly}
                onChange={(e) => onChange({ ...filters, remoteOnly: e.target.checked, hideRemote: e.target.checked ? false : filters.hideRemote })}
              />
              Remote only
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={filters.hideRemote}
                onChange={(e) => onChange({ ...filters, hideRemote: e.target.checked, remoteOnly: e.target.checked ? false : filters.remoteOnly })}
              />
              Hide remote
            </label>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Seniority level</div>
        <div className="flex flex-wrap gap-2">
          {(["intern","junior","mid","senior","lead","principal","executive"] as JobLevel[]).map((lvl) => {
            const on = filters.levels.includes(lvl);
            const count = levelCounts.get(lvl) ?? 0;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => onChange({ ...filters, levels: (toggleArr(filters.levels as string[], lvl) as JobLevel[]) })}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
              >
                {lvl} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">Country</div>
        <div className="flex flex-wrap gap-2">
          {countryCounts.slice(0, 14).map(([country, count]) => {
            const on = filters.countries.includes(country);
            return (
              <button
                key={country}
                type="button"
                onClick={() => onChange({ ...filters, countries: toggleArr(filters.countries, country) })}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
              >
                {country} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={filters.visaSponsorshipOnly}
            onChange={(e) => onChange({ ...filters, visaSponsorshipOnly: e.target.checked })}
          />
          Visa sponsorship only
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={filters.internationalOnly}
            onChange={(e) => onChange({ ...filters, internationalOnly: e.target.checked })}
          />
          Multi-country only
        </label>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-2">ATS source</div>
        <div className="flex flex-wrap gap-2">
          {atsCounts.map(([src, count]) => {
            const on = filters.atsSources.includes(src);
            return (
              <button
                key={src}
                type="button"
                onClick={() => onChange({ ...filters, atsSources: toggleArr(filters.atsSources, src) })}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
              >
                {src} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Max years required</div>
          <select
            value={filters.maxYearsRequired === null ? "any" : String(filters.maxYearsRequired)}
            onChange={(e) => onChange({ ...filters, maxYearsRequired: e.target.value === "any" ? null : parseInt(e.target.value, 10) })}
            className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="any">Any</option>
            <option value="0">Entry-level (no years specified)</option>
            <option value="1">≤ 1 year</option>
            <option value="2">≤ 2 years</option>
            <option value="3">≤ 3 years</option>
            <option value="5">≤ 5 years</option>
          </select>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-600 mb-2">Languages I speak (matches JDs needing any)</div>
          <div className="flex flex-wrap gap-2">
            {["English", "German", "French", "Spanish", "Dutch", "Italian", "Portuguese"].map((l) => {
              const on = filters.languages.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => onChange({ ...filters, languages: toggleArr(filters.languages, l) })}
                  className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-1 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {presets.length > 0 && <span className="text-xs text-gray-500">Saved:</span>}
          {presets.map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white border">
              <button onClick={() => onApplyPreset(p)} className="text-cinema-pine hover:underline">{p.name}</button>
              <button
                onClick={() => onDeletePreset(p.name)}
                className="text-gray-300 hover:text-red-600"
                aria-label={`Delete preset ${p.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button onClick={onSavePreset} className="text-xs px-2 py-1 rounded-full border border-cinema-sage text-cinema-pine hover:bg-cinema-mint/40">
            + Save as preset
          </button>
        </div>
        <button onClick={onReset} className="text-xs text-gray-600 underline hover:text-gray-800">
          Reset filters
        </button>
      </div>
    </div>
  );
}

function DraftModal({
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
