/**
 * Career-Buddy track catalogue.
 *
 * Single source of truth for the 18 tracks shown in the Profile UI
 * track-picker AND the (future) /jobs filter UI. Owning module so both
 * routes share label + hint + experience window without drift.
 *
 * `experienceMin` / `experienceMax` are years of full-time experience
 * derived from the human-readable `hint` (e.g. "Usually 5+ years" →
 * min: 5, max: undefined). Used by /jobs filter to surface stretch
 * picks vs realistic matches.
 */

export type TrackId =
  | "founders-associate"
  | "bizops"
  | "strategy"
  | "chief-of-staff"
  | "investment-analyst"
  | "bd"
  | "consulting"
  | "ib"
  | "pe"
  | "engineering"
  | "product"
  | "design"
  | "data"
  | "sales"
  | "marketing"
  | "ops"
  | "finance"
  | "legal";

export type Track = {
  id: TrackId;
  label: string;
  hint: string;
  experienceMin: number;
  experienceMax?: number;
};

export const TRACKS: readonly Track[] = [
  // Operator-track (the original Career-Buddy wedge)
  { id: "founders-associate", label: "Founders Associate / Special Projects", hint: "Early career, often direct from grad school. 0-3 years.",       experienceMin: 0, experienceMax: 3 },
  { id: "bizops",             label: "BizOps · Operating Associate",          hint: "Generalist analytics + execution. 1-4 years.",                  experienceMin: 1, experienceMax: 4 },
  { id: "strategy",           label: "Strategy",                              hint: "Often after consulting / banking. 2-5 years.",                  experienceMin: 2, experienceMax: 5 },
  { id: "chief-of-staff",     label: "Chief of Staff",                        hint: "Senior-IC, founder-adjacent. Usually 5+ years.",                experienceMin: 5 },
  { id: "investment-analyst", label: "Investment Analyst / Associate",        hint: "VC, pre-MBA. 1-4 years.",                                       experienceMin: 1, experienceMax: 4 },
  { id: "bd",                 label: "Business Development · Partnerships",   hint: "Outbound + dealmaking. 2-6 years.",                             experienceMin: 2, experienceMax: 6 },
  // Sector-shaped (broader job-DB)
  { id: "consulting",         label: "Consulting (MBB / Tier-2 / boutique)",  hint: "Structured problem-solving. 0-6 years (analyst → manager).",    experienceMin: 0, experienceMax: 6 },
  { id: "ib",                 label: "Investment Banking",                    hint: "M&A / Capital Markets / Coverage. 0-8 years.",                  experienceMin: 0, experienceMax: 8 },
  { id: "pe",                 label: "Private Equity",                        hint: "Pre-MBA → mid-cap. 2-7 years.",                                 experienceMin: 2, experienceMax: 7 },
  // Function-shaped (the rest of the 9,980)
  { id: "engineering",        label: "Engineering",                           hint: "Backend / frontend / infra / ML / data. 0-15 years.",           experienceMin: 0, experienceMax: 15 },
  { id: "product",            label: "Product Management",                    hint: "PM / APM / GPM. 1-10 years.",                                   experienceMin: 1, experienceMax: 10 },
  { id: "design",             label: "Design",                                hint: "Product / brand / research. 1-10 years.",                       experienceMin: 1, experienceMax: 10 },
  { id: "data",               label: "Data + Analytics",                      hint: "DS / DA / ML eng. 1-8 years.",                                  experienceMin: 1, experienceMax: 8 },
  { id: "sales",              label: "Sales · GTM",                           hint: "AE / SDR / GTM lead. 0-10 years.",                              experienceMin: 0, experienceMax: 10 },
  { id: "marketing",          label: "Marketing · Growth · Brand",            hint: "Growth / brand / content. 1-8 years.",                          experienceMin: 1, experienceMax: 8 },
  { id: "ops",                label: "Operations · People",                   hint: "Ops / HR / talent. 1-8 years.",                                 experienceMin: 1, experienceMax: 8 },
  { id: "finance",            label: "Finance · Accounting",                  hint: "FP&A / controller / corp dev. 1-8 years.",                      experienceMin: 1, experienceMax: 8 },
  { id: "legal",              label: "Legal · Compliance",                    hint: "GC / counsel / compliance. 3+ years.",                          experienceMin: 3 },
] as const;

/** Lookup helper. Returns undefined for unknown ids. */
export function getTrack(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

/**
 * True if a candidate with `years` of experience is in-window for the
 * track. Open-ended max (e.g. CoS "5+ years") is handled by treating
 * `experienceMax` as Infinity when undefined.
 */
export function isInExperienceWindow(track: Track, years: number): boolean {
  const max = track.experienceMax ?? Number.POSITIVE_INFINITY;
  return years >= track.experienceMin && years <= max;
}
