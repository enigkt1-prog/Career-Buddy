/**
 * Rich application-state types for the Career-Buddy monolith.
 *
 * Lifted from CareerBuddy.tsx without functional changes. Both the
 * monolith and future extracted components import from here so the
 * shape stays in sync as we split.
 *
 * Pure types + readonly constants. No localStorage, no React, no
 * runtime side-effects — see src/lib/state.ts for the `emptyState` /
 * `loadState` / `migrateProfile` helpers that read these types.
 */

import { type FilterPreset } from "./filter-presets";
import { type Filters, type JobLevel, type SortKey } from "./job-filters";
import { type MatchEntry } from "./match-cache";

// ---------------------------------------------------------------------------
// Application tracker
// ---------------------------------------------------------------------------

export type Status =
  | "applied"
  | "interview-1"
  | "interview-2"
  | "rejected"
  | "offer"
  | "follow-up-needed"
  | "confirmation";

export type Application = {
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

// ---------------------------------------------------------------------------
// Profile + work history
// ---------------------------------------------------------------------------

export type Position = {
  id: string;
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  location?: string;
  bullets: string[];
};

export type Education = {
  id: string;
  institution: string;
  degree: string;
  start_date?: string;
  end_date?: string;
};

export type CvAnalysisResponse = {
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

export type Profile = {
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

export type State = {
  applications: Application[];
  profile: Profile;
  sync_completed: boolean;
  dismissed_urls: string[];
};

// ---------------------------------------------------------------------------
// Drafts (cover letter / outreach / etc.)
// ---------------------------------------------------------------------------

export type DraftKind =
  | "cover_letter"
  | "outreach"
  | "feedback_request"
  | "thank_you"
  | "follow_up";

export type DraftResult = {
  subject: string;
  body: string;
  bullet_points_used?: string[];
};

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
  cover_letter: "Cover letter",
  outreach: "LinkedIn outreach",
  feedback_request: "Ask for feedback",
  thank_you: "Thank-you note",
  follow_up: "Follow-up nudge",
};

// ---------------------------------------------------------------------------
// Jobs feed
// ---------------------------------------------------------------------------

export type VcJob = {
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

export type ScoredJob = VcJob & { fit: number; why: string; matched: string[] };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROLE_CATEGORY_OPTIONS = [
  "founders-associate",
  "bizops",
  "strategy",
  "bd",
  "chief-of-staff",
  "investment-analyst",
] as const;

export const DEFAULT_PROFILE: Profile = {
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

export const SEED_APPS: Application[] = [];

export const CANNED_REPLY =
  "Got it. Target: Founders Associate at AI-startups + Operating Associate / BizOps / Strategy roles at early-stage startups. Geo: Berlin / Remote-DACH. Background: business track, 0–2y experience. Edit your profile any time to refine the fit.";

// ---------------------------------------------------------------------------
// Re-exports — keep one canonical entry point for downstream importers
// ---------------------------------------------------------------------------

export type { Filters, JobLevel, SortKey, FilterPreset, MatchEntry };
