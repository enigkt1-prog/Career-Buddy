import { createFileRoute } from "@tanstack/react-router";

import CareerBuddy from "@/components/CareerBuddy";
import {
  CinematicHero,
  PillLink,
  SectionDivider,
} from "@/components/cinema";
import { usePhoto } from "@/lib/cinema-theme";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Career-Buddy — Land your first startup role" },
      {
        name: "description",
        content:
          "Application tracker for business-background grads chasing Founders Associate, BizOps, Strategy and BD roles.",
      },
    ],
  }),
});

function Index() {
  // Hero image follows the active cinema theme (Sage = coworking,
  // Onyx = skyscrapers, Slate = monochrome boardroom, Coral = studio).
  const heroImage = usePhoto("overview");
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={heroImage}
        altText="Overview — workspace photography that follows your selected track"
        eyebrow="Overview"
        scrollVh={10}
        headline={<>Your operator-track feed.</>}
        subhead={
          <>
            Applications you're tracking, fresh roles graded against your CV,
            and the small nudges that move the search forward — all on one
            calm page. No spam, no popups, no LinkedIn theatre.
          </>
        }
        cta={
          <>
            <PillLink href="#applications">Open tracker</PillLink>
            <PillLink href="/cv" variant="soft">
              Upload CV
            </PillLink>
          </>
        }
      />
      <SectionDivider from="cream" to="white" />
      <CareerBuddy />
    </div>
  );
}
