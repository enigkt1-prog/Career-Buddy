import { createFileRoute } from "@tanstack/react-router";

import {
  CinematicHero,
  GlassCard,
  GlassPanel,
  LogoStrip,
  PillLink,
  RevealOnScroll,
  SectionDivider,
  StatBlock,
} from "@/components/cinema";

export const Route = createFileRoute("/design-preview")({
  component: DesignPreviewPage,
});

// Cinematic photography — modern workspace + coworking direction
// (Phase 0.5 swap from forest, which felt off-brand for a career app).
// Unsplash CDN. If a photo ID stops returning a proper image
// Content-Type the browser's ORB will block it silently — verify via
// browser_network_requests before replacing.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=2400&q=80";
const STORY_IMAGE =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=2400&q=80";

const RECRUITER_LOGOS = [
  { name: "Ashby" },
  { name: "Greenhouse" },
  { name: "Lever" },
  { name: "Workable" },
  { name: "Personio" },
  { name: "Recruitee" },
];

function DesignPreviewPage() {
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={HERO_IMAGE}
        altText="Career-Buddy hero — soft alpine landscape, the buddy that walks beside you"
        eyebrow="Career-Buddy · for the operator track"
        scrollVh={20}
        headline={<>A buddy for your job hunt.</>}
        subhead={
          <>
            Founders Associate, BizOps, Strategy, BD, Chief of Staff,
            Investment Analyst — every fresh European and US opening, graded
            against your CV, gathered in one calm feed. No spam, no popups,
            no LinkedIn theatre.
          </>
        }
        cta={
          <>
            <PillLink href="/">Open Overview</PillLink>
            <PillLink href="/buddy" variant="soft">
              Talk to Buddy
            </PillLink>
          </>
        }
      />

      <LogoStrip logos={RECRUITER_LOGOS} />

      <SectionDivider from="cream" to="white" />

      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32 grid grid-cols-1 md:grid-cols-12 gap-12 items-start">
          <RevealOnScroll className="md:col-span-7">
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-6">
              Why Buddy
            </div>
            <h2 className="text-cinema-h1 mb-6">
              <span className="cinema-headline-underline">
                The operator track is real.
              </span>{" "}
              It just isn't on LinkedIn.
            </h2>
            <p className="text-cinema-body mb-4">
              You graduated, you're sharp, you'd rather build than consult — and
              the roles you actually want hide inside venture-backed company
              ATSes that LinkedIn never properly indexes. "Founders Associate"
              alone covers fifteen different jobs. Buddy fixes both problems.
            </p>
            <p className="text-cinema-body">
              We scrape every Greenhouse, Lever, Ashby, Workable, Personio and
              Recruitee board the European + US VCs we trust actually post on,
              classify each role into the seven operator-track buckets that
              matter, and grade every single one against your CV. The interface
              is calm on purpose. So is the inbox: nothing is sent to you that
              you didn't ask for.
            </p>
          </RevealOnScroll>

          <RevealOnScroll delay={120} className="md:col-span-5 relative">
            <div
              className="relative overflow-hidden rounded-[1.75rem]"
              style={{
                backgroundImage: `url("${STORY_IMAGE}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(28,38,30,0.10) 0%, rgba(28,38,30,0.50) 100%)",
                }}
                aria-hidden
              />
              <GlassCard
                variant="dark"
                padding="lg"
                className="relative m-4 md:m-6"
              >
                <div className="text-cinema-eyebrow text-cinema-cream/70 mb-4">
                  Live, right now
                </div>
                <StatBlock
                  value="9,980"
                  label="Active roles, refreshed every night from 209 venture-backed firms and the companies they fund."
                  tone="dark"
                />
                <div className="h-px bg-white/15 my-6" />
                <StatBlock
                  value="883"
                  label="Operator-track roles already classified into Founders Associate, BizOps, Strategy, BD, Chief of Staff, Investment Analyst — Tier-2 grades the rest each morning."
                  tone="dark"
                />
              </GlassCard>
            </div>
          </RevealOnScroll>
        </div>
      </section>

      <SectionDivider from="white" to="cream" />

      <section className="bg-cinema-cream">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24 md:py-32">
          <RevealOnScroll>
            <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
              How Buddy works
            </div>
            <h2 className="text-cinema-h1 max-w-3xl">
              <span className="cinema-headline-underline">
                Three quiet layers
              </span>{" "}
              between your CV and your next role.
            </h2>
          </RevealOnScroll>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <RevealOnScroll>
              <GlassCard variant="cream" padding="lg" className="h-full">
                <div className="text-cinema-eyebrow text-cinema-ink-mute mb-3">
                  01 — Gather
                </div>
                <h3 className="text-cinema-h2 mb-3">Direct from the source.</h3>
                <p className="text-cinema-body">
                  Buddy reads each VC's careers page, follows the ATS embed,
                  and pulls the raw posting. No middlemen, no LinkedIn repost
                  lag, no fake "actively hiring" badges.
                </p>
              </GlassCard>
            </RevealOnScroll>

            <RevealOnScroll delay={80}>
              <GlassCard variant="cream" padding="lg" className="h-full">
                <div className="text-cinema-eyebrow text-cinema-ink-mute mb-3">
                  02 — Classify
                </div>
                <h3 className="text-cinema-h2 mb-3">Tier-1 + Tier-2.</h3>
                <p className="text-cinema-body">
                  A precise regex pass catches the obvious operator titles.
                  Everything else goes to a Gemini grader against the
                  seven-bucket taxonomy, so "Founding GTM" lands next to
                  "Chief of Staff" and not next to "Senior C++ Engineer".
                </p>
              </GlassCard>
            </RevealOnScroll>

            <RevealOnScroll delay={160}>
              <GlassCard variant="cream" padding="lg" className="h-full">
                <div className="text-cinema-eyebrow text-cinema-ink-mute mb-3">
                  03 — Match
                </div>
                <h3 className="text-cinema-h2 mb-3">Honest fit-score.</h3>
                <p className="text-cinema-body">
                  Upload your CV once. Every role gets a personalised score, a
                  draft outreach you'd actually send, and a polite "skip this
                  one" when the fit isn't there. Buddy's job is to save your
                  time, not flatter you.
                </p>
              </GlassCard>
            </RevealOnScroll>
          </div>
        </div>
      </section>

      <section className="relative bg-cinema-cream">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
          <RevealOnScroll>
            <GlassPanel className="md:flex md:items-center md:justify-between gap-12">
              <div className="max-w-xl">
                <div className="text-cinema-eyebrow text-cinema-ink-mute mb-4">
                  Ready when you are
                </div>
                <h2 className="text-cinema-h1 mb-4">Start with your CV.</h2>
                <p className="text-cinema-body">
                  9,980 live operator roles and your CV in one calm feed.
                  Free while in beta — no credit card, no waitlist.
                </p>
              </div>
              <div className="mt-8 md:mt-0 flex flex-wrap gap-3">
                <PillLink href="/cv">Upload CV</PillLink>
                <PillLink href="/buddy" variant="soft">
                  Ask Buddy first
                </PillLink>
              </div>
            </GlassPanel>
          </RevealOnScroll>
        </div>
      </section>

    </div>
  );
}
