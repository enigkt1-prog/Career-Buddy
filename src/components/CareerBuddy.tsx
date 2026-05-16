import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Loader2, Upload, Pencil, Plus, Trash2, X, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { extractCvText } from "@/lib/cv-parser";
import {
  fitColor,
  formatSalary,
  relativeDays,
  statusBadge,
} from "@/lib/format";
import {
  buildProfileTokens,
  fitScore,
  fitWhy,
  profileYearsExperience,
  tokenize,
} from "@/lib/job-fit";
import {
  cleanSnippet,
  profileCompleteness,
  profileSignature,
  safeIsoDate,
} from "@/lib/jobs-helpers";
import {
  loadPresets,
  persistPresets,
  type FilterPreset,
} from "@/lib/filter-presets";
import {
  MATCH_CACHE_KEY,
  MATCH_DAILY_LIMIT,
  MATCH_QUOTA_COOLDOWN_MS,
  MATCH_QUOTA_KEY,
  loadMatchCache,
  persistMatchCache,
  readQuotaState,
  writeQuotaState,
  type MatchCache,
  type MatchEntry,
  type MatchResult,
} from "@/lib/match-cache";
import {
  emptyState,
  loadState,
  migrateProfile,
} from "@/lib/state";
import {
  CANNED_REPLY,
  DEFAULT_PROFILE,
  DRAFT_KIND_LABEL,
  ROLE_CATEGORY_OPTIONS,
  SEED_APPS,
  type Application,
  type CvAnalysisResponse,
  type DraftKind,
  type DraftResult,
  type Education,
  type JobLevel,
  type Position,
  type Profile,
  type ScoredJob,
  type State,
  type Status,
  type VcJob,
} from "@/lib/types";
import { STORAGE_KEY } from "@/lib/cv-storage";
import { setProfileFromAnalysis } from "@/lib/profile-store";
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
import { useCareerBuddyApplications } from "@/lib/use-career-buddy-state";
import { AddAppModal } from "@/components/applications/AddAppModal";
import { ApplicationsTracker } from "@/components/applications/ApplicationsTracker";
import { DraftModal } from "@/components/drafts/DraftModal";
import { FilterBar } from "@/components/jobs/FilterBar";
import { JobCard } from "@/components/jobs/JobCard";
import { InsightsPanel } from "@/components/insights/InsightsPanel";
import { EditProfileModal } from "@/components/profile/EditProfileModal";
import { ProfileCard } from "@/components/profile/ProfileCard";

// All rich-state types (Status / Application / Position / Education /
// CvAnalysisResponse / Profile / State / DraftKind / DraftResult /
// JobLevel / VcJob / ScoredJob) + constants (DEFAULT_PROFILE /
// ROLE_CATEGORY_OPTIONS / SEED_APPS / DRAFT_KIND_LABEL / CANNED_REPLY)
// moved to src/lib/types.ts.
// State helpers (emptyState / loadState / migrateProfile) moved to
// src/lib/state.ts.
// STORAGE_KEY moved to src/lib/cv-storage.ts.
// All imported above.

// statusBadge / fitColor / todayISO / formatSalary / relativeDays
// moved to src/lib/format.ts (imported above).

// fitScore moved to src/lib/job-fit.ts (imported below).

// FILTER_PRESETS_KEY / FilterPreset / loadPresets / persistPresets
// moved to src/lib/filter-presets.ts (imported above).

// serializeFilters / parseFiltersFromHash / sortJobs / countActiveFilters
// moved to src/lib/job-filters.ts (imported above).

// profileCompleteness / cleanSnippet / applicationToRow / safeIsoDate /
// profileSignature moved to src/lib/jobs-helpers.ts (imported above).
// applyFilters moved to src/lib/job-filters.ts (imported above).

// MATCH_CACHE_KEY / MATCH_QUOTA_KEY / MATCH_QUOTA_COOLDOWN_MS /
// MATCH_DAILY_LIMIT / loadMatchCache / persistMatchCache /
// readQuotaState / writeQuotaState moved to src/lib/match-cache.ts
// (imported above).

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

  async function applyAnalysis(analysis: CvAnalysisResponse) {
    // Canonical CV-persist path — localStorage + best-effort Supabase
    // upsert + the F2 radar snapshot. Same helper the Profile route's
    // CvUploadInline calls; no second persistence path.
    await setProfileFromAnalysis(analysis, cvFilename ?? "cv.txt");
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
          radar: analysis.radar ?? p.radar,
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
        body: {
          cvText,
          targetProfile: target,
          // Drives the target-profile-aware radar axis set (F2).
          targetRoleCategories: state.profile.target_role_categories,
          cvFilename: cvFilename ?? undefined,
        },
      });
      if (error) throw error;
      const payload = data as { analysis?: CvAnalysisResponse; error?: string };
      if (!payload?.analysis) throw new Error(payload?.error || "No analysis returned");
      await applyAnalysis(payload.analysis);
    } catch (e) {
      setCvError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setCvLoading(false);
    }
  }

  // Applications mutators extracted into a hook so F4 chat tool
  // handlers can share the same add/update/delete logic. Hook
  // operates on the monolith's state slice via a setter adapter.
  const applicationsApi = useCareerBuddyApplications(
    state.applications,
    (updater) =>
      setState((s) => ({ ...s, applications: updater(s.applications) })),
  );
  const { addApplication, updateApplication, deleteApplication } =
    applicationsApi;

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

// CANNED_REPLY moved to src/lib/types.ts (imported above).

