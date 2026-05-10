import { createFileRoute } from "@tanstack/react-router";

import CareerBuddy from "@/components/CareerBuddy";
import { CinematicHero, SectionDivider } from "@/components/cinema";

export const Route = createFileRoute("/jobs")({
  component: JobsPage,
  head: () => ({
    meta: [
      { title: "Career-Buddy — All live jobs" },
      {
        name: "description",
        content:
          "Every live operator-track role in one filterable feed. 9,980 openings across 209 venture-backed firms and their portfolio companies.",
      },
    ],
  }),
});

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=2400&q=80";

/**
 * Phase 0.5b minimum-viable jobs page. Renders CareerBuddy with the
 * `rolesOnly` flag — same role grid + filters + sort + RoleCards as
 * Overview, but profile / tracker / CV sections hidden. Phase 3 will
 * lift the role-grid into its own `src/components/jobs/*` module so
 * /jobs and / can render it without coupling to CareerBuddy state.
 */
function JobsPage() {
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={HERO_IMAGE}
        altText="All live jobs — modern coworking light, every operator role in one feed"
        eyebrow="All live jobs"
        scrollVh={5}
        headline={<>Every role we found.</>}
        subhead={
          <>
            One filterable feed across 209 venture-backed firms and the
            companies they fund. Filter by role, level, country, ATS,
            languages, salary, recency, remote, visa. Sort by best fit
            against your CV.
          </>
        }
      />
      <SectionDivider from="cream" to="white" />
      <CareerBuddy rolesOnly />
    </div>
  );
}
