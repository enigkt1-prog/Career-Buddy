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
import { CvInsights } from "@/components/profile/CvInsights";
import { CvRadar } from "@/components/profile/CvRadar";
import { CvUploadInline } from "@/components/profile/CvUploadInline";
import { EmailAccounts } from "@/components/profile/EmailAccounts";
import { ThemePicker } from "@/components/profile/ThemePicker";
import { usePhoto } from "@/lib/cinema-theme";
import {
  loadCareerBuddyState,
  type CvRadar as CvRadarData,
  type SkillEntry,
} from "@/lib/cv-storage";
import {
  initProfileFromSupabase,
  loadSelectedTracks,
  loadYearsBucket,
  setSelectedTracks as persistSelectedTracks,
  setYearsBucket as persistYearsBucket,
  type YearsBucketId,
} from "@/lib/profile-store";
import { TRACKS } from "@/lib/tracks";

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

// Hero image follows the active cinema theme — see src/lib/cinema-theme.ts.
//
// TRACKS now lives in src/lib/tracks.ts (single source of truth shared
// with future /jobs filter UI). See lib/tracks.ts for type + experience
// window helpers.

const EXPERIENCE_BUCKETS = [
  { id: "lt1",   label: "Less than 1 year"   },
  { id: "1to2",  label: "1–2 years"           },
  { id: "3to5",  label: "3–5 years"           },
  { id: "6to10", label: "6–10 years"          },
  { id: "gt10",  label: "More than 10 years" },
];

function readSkillsFromState(): SkillEntry[] {
  const raw = loadCareerBuddyState().profile?.skills;
  return Array.isArray(raw) ? raw : [];
}

function readRadarFromState(): CvRadarData | null {
  const raw = loadCareerBuddyState().profile?.radar;
  if (raw && Array.isArray(raw.axes) && raw.axes.length > 0) {
    return raw;
  }
  return null;
}

function ProfilePage() {
  const heroImage = usePhoto("profile");
  const [yearsBucket, setYearsBucketState] = useState<YearsBucketId | null>(null);
  const [selectedTracks, setSelectedTracksState] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [radar, setRadar] = useState<CvRadarData | null>(null);

  useEffect(() => {
    setSelectedTracksState(loadSelectedTracks());
    setYearsBucketState(loadYearsBucket());
    setSkills(readSkillsFromState());
    setRadar(readRadarFromState());
    // Best-effort cross-device sync: if Supabase has a newer profile,
    // merge it into local state, then re-read so Section 03 reflects
    // any remote skills the user uploaded on another device.
    void initProfileFromSupabase().then(() => {
      setSkills(readSkillsFromState());
      setSelectedTracksState(loadSelectedTracks());
      setYearsBucketState(loadYearsBucket());
      setRadar(readRadarFromState());
    });
  }, []);

  function toggleTrack(id: string) {
    const next = selectedTracks.includes(id)
      ? selectedTracks.filter((t) => t !== id)
      : [...selectedTracks, id];
    setSelectedTracksState(next);
    persistSelectedTracks(next);
  }

  function setYears(id: string) {
    setYearsBucketState(id as YearsBucketId);
    persistYearsBucket(id as YearsBucketId);
  }

  function refreshAfterCv() {
    setSkills(readSkillsFromState());
    setSelectedTracksState(loadSelectedTracks());
    setRadar(readRadarFromState());
  }

  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={heroImage}
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
                {skills.length > 0
                  ? `Extracted from your CV · ${skills.length}`
                  : "Skills board"}
              </div>
              {skills.length === 0 ? (
                <>
                  <p className="text-cinema-body text-cinema-ink-soft mb-4">
                    No skills yet. Drop your CV in section 04 and Buddy will
                    extract a structured list — Python, fundraising, B2B
                    sales — with an inferred level for each.
                  </p>
                  <a
                    href="#cv-upload"
                    className="inline-flex items-center gap-2 rounded-full bg-cinema-moss px-4 py-2 text-base text-cinema-cream font-medium"
                  >
                    Upload CV
                  </a>
                </>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {skills.map((s, i) => (
                    <li key={`${s.name}-${i}`}>
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("open-buddy", {
                              detail: {
                                prefill: `Tell me about my ${s.name} experience — what projects on my CV show real depth, and what's the next stretch?`,
                              },
                            }),
                          )
                        }
                        title={`Probe ${s.name} with Buddy`}
                        className="inline-flex items-center gap-2 rounded-full border border-cinema-mint bg-white px-3 py-1.5 text-base text-cinema-ink hover:bg-cinema-mint/40 transition-colors"
                      >
                        <span className="font-medium">{s.name}</span>
                        {s.level && (
                          <span className="text-cinema-ink-mute text-cinema-caption uppercase tracking-wider">
                            {s.level}
                          </span>
                        )}
                        {typeof s.years === "number" && s.years > 0 && (
                          <span className="text-cinema-ink-mute">· {s.years}y</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              <CvUploadInline onAnalysed={refreshAfterCv} />
              {radar && (
                <div className="border-t border-cinema-mint pt-8">
                  <div className="text-cinema-eyebrow text-cinema-ink-mute mb-2">
                    Your CV radar
                  </div>
                  <p className="text-cinema-body max-w-2xl mb-8">
                    Six axes scored from your CV. Tap any axis or insight
                    card to dig into it with Buddy.
                  </p>
                  <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
                    <CvRadar radar={radar} />
                    <CvInsights radar={radar} />
                  </div>
                </div>
              )}
            </GlassPanel>
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="cream" to="white" />

      {/* Section 5 — Email accounts (Phase 1.5 stub) */}
      <section id="email" className="bg-white scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
          <RevealOnScroll className="md:col-span-5">
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              05 — Email
            </div>
            <h2 className="text-cinema-h1 mb-4">
              <span className="cinema-headline-underline">
                Connect your inbox.
              </span>
            </h2>
            <p className="text-cinema-body">
              Buddy can read replies, draft outreach from your address,
              and surface interview invites in your tracker — once your
              email is connected. Multiple accounts supported, set a
              primary, disconnect any time.
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={120} className="md:col-span-7">
            <EmailAccounts />
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="white" to="cream" />

      {/* Section 6 — Theme picker (Phase 4 step 3) */}
      <section id="theme" className="bg-cinema-cream scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-20 md:py-24 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
          <RevealOnScroll className="md:col-span-5">
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              06 — Theme
            </div>
            <h2 className="text-cinema-h1 mb-4">
              <span className="cinema-headline-underline">
                Pick the world
              </span>{" "}
              you're heading into.
            </h2>
            <p className="text-cinema-body mb-3">
              Career-Buddy re-skins itself per persona — colour palette,
              hero photography, hover accents — so the app feels like it
              belongs to your track.
            </p>
            <p className="text-cinema-body">
              Sage for early-stage operator. Onyx for IB / PE / late-stage
              VC. Slate for consulting. Coral for brand / creative / D2C.
              Pick anytime; the UI swaps live.
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={120} className="md:col-span-7">
            <ThemePicker />
          </RevealOnScroll>
        </div>
      </section>
    </div>
  );
}
