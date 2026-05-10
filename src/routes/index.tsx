import { createFileRoute } from "@tanstack/react-router";

import CareerBuddy from "@/components/CareerBuddy";
import {
  CinematicHero,
  PillLink,
  SectionDivider,
} from "@/components/cinema";

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

// Cinematic photography — modern workspace at golden hour. Urban /
// office direction (Phase 0.5 swap from forest, which felt off-brand
// for a career app).
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=2400&q=80";

function Index() {
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={HERO_IMAGE}
        altText="Overview — soft pine-forest light, the buddy that walks beside you"
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
