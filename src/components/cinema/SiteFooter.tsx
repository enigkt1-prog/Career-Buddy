import { cn } from "@/lib/utils";

import { GlassCard, GlassCardInner } from "./GlassCard";

type Props = {
  /** Optional backdrop image — same warm-cinematic vocabulary as hero. */
  image?: string;
  className?: string;
};

// Modern coworking interior — calm, plant-forward, cool light.
// Phase 0.5 swap from forest sun-rays, which felt off-brand for a
// career app.
const FOOTER_IMAGE_DEFAULT =
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=2400&q=80";

const PAGES = [
  { href: "/", label: "Overview" },
  { href: "/jobs", label: "Jobs" },
  { href: "/profile", label: "Profile" },
  { href: "/buddy", label: "Buddy" },
];

const BUILT_FOR = [
  "Recent business grads",
  "Engineers pivoting to ops",
  "Consultants → startup",
  "Second-job operators",
];

const QUIET_BY_DEFAULT = [
  "No tracking pixels",
  "No LinkedIn login",
  "No spam outreach",
  "Just roles + your CV",
];

/**
 * Site-wide cinema footer — same visual vocabulary as the hero
 * (cinematic photo + four warm-glass cards floating over). Used at
 * the bottom of every page so the whole app feels like one piece.
 */
export function SiteFooter({ image = FOOTER_IMAGE_DEFAULT, className }: Props) {
  return (
    <section
      className={cn("relative w-full overflow-hidden", className)}
      style={{ minHeight: "70vh" }}
    >
      <div
        className="absolute inset-0 bg-cinema-moss"
        style={{
          backgroundImage: `url("${image}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
        role="presentation"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(28,38,30,0.05) 0%, rgba(28,38,30,0.55) 100%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pt-24 pb-8 flex flex-col">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <GlassCard variant="warm" padding="lg" className="md:col-span-3">
            <div>
              <div className="text-cinema-h2 mb-1">Career-Buddy</div>
              <div className="text-cinema-caption">
                2026 — built quietly in Berlin.
              </div>
            </div>
          </GlassCard>

          <GlassCard variant="warm" padding="md" className="md:col-span-3 min-h-[10rem]">
            <div className="text-cinema-eyebrow text-cinema-ink/70 mb-3">
              Pages
            </div>
            <GlassCardInner>
              <ul className="space-y-1.5 text-base">
                {PAGES.map((p) => (
                  <li key={p.href}>
                    <a
                      href={p.href}
                      className="text-cinema-ink hover:text-cinema-pine no-underline"
                    >
                      {p.label}
                    </a>
                  </li>
                ))}
              </ul>
            </GlassCardInner>
          </GlassCard>

          <GlassCard variant="warm" padding="md" className="md:col-span-3 min-h-[10rem]">
            <div className="text-cinema-eyebrow text-cinema-ink/70 mb-3">
              Built for
            </div>
            <GlassCardInner>
              <ul className="space-y-1.5 text-base">
                {BUILT_FOR.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </GlassCardInner>
          </GlassCard>

          <GlassCard variant="warm" padding="md" className="md:col-span-3 min-h-[10rem]">
            <div className="text-cinema-eyebrow text-cinema-ink/70 mb-3">
              Quiet by default
            </div>
            <GlassCardInner>
              <ul className="space-y-1.5 text-base">
                {QUIET_BY_DEFAULT.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </GlassCardInner>
          </GlassCard>
        </div>

        <div className="mt-6 text-cinema-cream/80 text-base flex flex-wrap items-center gap-x-6 gap-y-2">
          <span>© 2026 Career-Buddy</span>
          <span>Privacy</span>
          <span>Terms</span>
        </div>
      </div>
    </section>
  );
}
