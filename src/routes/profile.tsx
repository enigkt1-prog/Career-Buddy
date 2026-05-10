import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mic } from "lucide-react";

import {
  CinematicHero,
  GlassCard,
  GlassPanel,
  PillLink,
  RevealOnScroll,
  SectionDivider,
} from "@/components/cinema";
import { CvUploadInline } from "@/components/profile/CvUploadInline";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "Career-Buddy — Profile" },
      {
        name: "description",
        content:
          "Your profile drives every fit-score Buddy computes: years of experience, the tracks you'd consider, the skills extracted from your CV.",
      },
    ],
  }),
});

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2400&q=80";

// Phase 0.5 — broader bucket set covering the actual job-DB shape
// (9,980 active roles span engineering, product, sales, marketing,
// ops, finance, design, data, legal, plus the original operator
// track). Hint copy includes typical experience needed so users
// know e.g. Chief of Staff isn't an entry-level role.
const TRACKS = [
  // Operator-track (the original Career-Buddy wedge)
  { id: "founders-associate", label: "Founders Associate / Special Projects", hint: "Early career, often direct from grad school. 0-3 years." },
  { id: "bizops",             label: "BizOps · Operating Associate",            hint: "Generalist analytics + execution. 1-4 years." },
  { id: "strategy",           label: "Strategy",                                 hint: "Often after consulting / banking. 2-5 years." },
  { id: "chief-of-staff",     label: "Chief of Staff",                          hint: "Senior-IC, founder-adjacent. Usually 5+ years." },
  { id: "investment-analyst", label: "Investment Analyst / Associate",          hint: "VC, pre-MBA. 1-4 years." },
  { id: "bd",                 label: "Business Development · Partnerships",     hint: "Outbound + dealmaking. 2-6 years." },
  // Sector-shaped (broader job-DB)
  { id: "consulting",         label: "Consulting (MBB / Tier-2 / boutique)",   hint: "Structured problem-solving. 0-6 years (analyst → manager)." },
  { id: "ib",                 label: "Investment Banking",                     hint: "M&A / Capital Markets / Coverage. 0-8 years." },
  { id: "pe",                 label: "Private Equity",                          hint: "Pre-MBA → mid-cap. 2-7 years." },
  // Function-shaped (the rest of the 9,980)
  { id: "engineering",        label: "Engineering",                             hint: "Backend / frontend / infra / ML / data. 0-15 years." },
  { id: "product",            label: "Product Management",                      hint: "PM / APM / GPM. 1-10 years." },
  { id: "design",             label: "Design",                                  hint: "Product / brand / research. 1-10 years." },
  { id: "data",               label: "Data + Analytics",                        hint: "DS / DA / ML eng. 1-8 years." },
  { id: "sales",              label: "Sales · GTM",                             hint: "AE / SDR / GTM lead. 0-10 years." },
  { id: "marketing",          label: "Marketing · Growth · Brand",              hint: "Growth / brand / content. 1-8 years." },
  { id: "ops",                label: "Operations · People",                     hint: "Ops / HR / talent. 1-8 years." },
  { id: "finance",            label: "Finance · Accounting",                    hint: "FP&A / controller / corp dev. 1-8 years." },
  { id: "legal",              label: "Legal · Compliance",                      hint: "GC / counsel / compliance. 3+ years." },
] as const;

const EXPERIENCE_BUCKETS = [
  { id: "lt1",   label: "Less than 1 year"   },
  { id: "1to2",  label: "1–2 years"           },
  { id: "3to5",  label: "3–5 years"           },
  { id: "6to10", label: "6–10 years"          },
  { id: "gt10",  label: "More than 10 years" },
];

function ProfilePage() {
  const [yearsBucket, setYearsBucket] = useState<string | null>(null);
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawTracks = localStorage.getItem("career-buddy-tracks-v1");
      if (rawTracks) setSelectedTracks(JSON.parse(rawTracks) as string[]);
      const rawYears = localStorage.getItem("career-buddy-years-bucket-v1");
      if (rawYears) setYearsBucket(rawYears);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleTrack(id: string) {
    const next = selectedTracks.includes(id)
      ? selectedTracks.filter((t) => t !== id)
      : [...selectedTracks, id];
    setSelectedTracks(next);
    try {
      localStorage.setItem("career-buddy-tracks-v1", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function setYears(id: string) {
    setYearsBucket(id);
    try {
      localStorage.setItem("career-buddy-years-bucket-v1", id);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={HERO_IMAGE}
        altText="Profile — modern workspace at golden hour, the buddy that knows where you want to go"
        eyebrow="Profile"
        scrollVh={10}
        headline={<>The shape of your search.</>}
        subhead={
          <>
            A few honest answers about where you are and where you'd go next,
            plus your CV. Buddy uses both to grade every live role and to
            draft every cover letter.
          </>
        }
        cta={
          <>
            <PillLink href="#cv-upload">Upload CV</PillLink>
            <PillLink href="#tracks" variant="soft">
              Pick tracks
            </PillLink>
          </>
        }
      />

      <SectionDivider from="cream" to="white" />

      {/* Section 1 — Years of experience */}
      <section id="experience" className="bg-white scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24">
          <RevealOnScroll>
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              01 — Where you are
            </div>
            <h2 className="text-cinema-h1 mb-4 max-w-3xl">
              <span className="cinema-headline-underline">
                How much full-time experience
              </span>{" "}
              do you have?
            </h2>
            <p className="text-cinema-body max-w-2xl mb-8">
              Buddy uses this to filter roles that demand seniority you don't
              have yet (Chief of Staff is usually 5+ years; Founders Associate
              is typically 0-3) and to surface stretch roles you can grow into.
            </p>
          </RevealOnScroll>
          <RevealOnScroll>
            <div className="flex flex-wrap gap-3">
              {EXPERIENCE_BUCKETS.map((b) => {
                const active = yearsBucket === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => setYears(b.id)}
                    className={[
                      "rounded-full border px-5 py-3 text-base transition-colors",
                      active
                        ? "bg-cinema-moss text-cinema-cream border-cinema-moss"
                        : "bg-cinema-mist border-cinema-mint text-cinema-ink hover:bg-cinema-mint/60",
                    ].join(" ")}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="white" to="cream" />

      {/* Section 2 — Tracks */}
      <section id="tracks" className="bg-cinema-cream scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24">
          <RevealOnScroll>
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              02 — Tracks
            </div>
            <h2 className="text-cinema-h1 mb-4 max-w-3xl">
              <span className="cinema-headline-underline">
                Which paths
              </span>{" "}
              are you actually open to?
            </h2>
            <p className="text-cinema-body max-w-2xl mb-10">
              Pick one or several. Buddy filters the live job feed against
              these and tunes cover-letter drafts to match. Each chip shows
              the kind of experience the role usually needs, so you can spot
              the stretch picks. Toggle anytime.
            </p>
          </RevealOnScroll>

          <RevealOnScroll>
            <div className="flex flex-wrap gap-3">
              {TRACKS.map((t) => {
                const active = selectedTracks.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTrack(t.id)}
                    className={[
                      "rounded-full border px-5 py-3 text-base transition-colors text-left max-w-md",
                      active
                        ? "bg-cinema-moss text-cinema-cream border-cinema-moss"
                        : "bg-white border-cinema-mint text-cinema-ink hover:bg-cinema-mint/60",
                    ].join(" ")}
                  >
                    <div className="font-semibold">{t.label}</div>
                    <div
                      className={[
                        "text-base mt-0.5",
                        active ? "text-cinema-cream/85" : "text-cinema-ink-mute",
                      ].join(" ")}
                    >
                      {t.hint}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-cinema-caption mt-6">
              Saved locally for now — Phase 1 syncs this to your account.
            </p>
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="cream" to="white" />

      {/* Section 3 — Skills */}
      <section id="skills" className="bg-white scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
          <RevealOnScroll className="md:col-span-7">
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              03 — Skills
            </div>
            <h2 className="text-cinema-h1 mb-4">
              <span className="cinema-headline-underline">
                Skills come from your CV.
              </span>
            </h2>
            <p className="text-cinema-body mb-4">
              Drop the CV in the next section. Buddy extracts work history,
              named tools, named skills, and education. You can correct any
              of it inline.
            </p>
            <p className="text-cinema-body">
              When something looks thin Buddy asks. Example: "I see Python on
              your CV — what was your most recent project?" Voice input ships
              with Phase 1 (Web Speech API, browser-native, free).
            </p>
          </RevealOnScroll>

          <RevealOnScroll delay={120} className="md:col-span-5">
            <GlassCard variant="cream" padding="lg">
              <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
                Coming with Phase 1
              </div>
              <ul className="space-y-2 text-base text-cinema-ink-soft">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-cinema-pine flex-shrink-0" />
                  <span>Skills auto-extracted from your CV</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-cinema-pine flex-shrink-0" />
                  <span>Buddy-led skill-probe questions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-cinema-pine flex-shrink-0" />
                  <span>Voice answers via Web Speech API</span>
                </li>
              </ul>
              <button
                disabled
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-cinema-mint px-4 py-2 text-base text-cinema-ink-mute cursor-not-allowed opacity-70"
                title="Voice input ships in Phase 1"
              >
                <Mic className="w-4 h-4" />
                Speak instead (Phase 1)
              </button>
            </GlassCard>
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="white" to="cream" />

      {/* Section 4 — CV upload (inline, no nav-jump) */}
      <section id="cv-upload" className="bg-cinema-cream scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24">
          <RevealOnScroll>
            <GlassPanel className="grid gap-8">
              <div>
                <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
                  04 — CV
                </div>
                <h2 className="text-cinema-h1 mb-4">Drop your CV here.</h2>
                <p className="text-cinema-body max-w-2xl">
                  PDF, .docx or .txt. Buddy reads it, extracts the structured
                  profile, and saves it locally so the Overview is ready when
                  you switch over. No raw file ever leaves your browser
                  un-sanitised.
                </p>
              </div>
              <CvUploadInline />
            </GlassPanel>
          </RevealOnScroll>
        </div>
      </section>
    </div>
  );
}
