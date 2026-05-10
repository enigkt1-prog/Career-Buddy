import { createFileRoute } from "@tanstack/react-router";

import CareerBuddy from "@/components/CareerBuddy";
import { CinematicHero, SectionDivider } from "@/components/cinema";
import { usePhoto } from "@/lib/cinema-theme";

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

/**
 * Phase 0.5b minimum-viable jobs page. Renders CareerBuddy with the
 * `rolesOnly` flag — same role grid + filters + sort + RoleCards as
 * Overview, but profile / tracker / CV sections hidden. Phase 3 will
 * lift the role-grid into its own `src/components/jobs/*` module so
 * /jobs and / can render it without coupling to CareerBuddy state.
 */
function JobsPage() {
  const heroImage = usePhoto("jobs");
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={heroImage}
        altText="All live jobs — workspace photography that follows your selected track"
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
