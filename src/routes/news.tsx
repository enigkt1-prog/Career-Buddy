import { createFileRoute } from "@tanstack/react-router";

import { CinematicHero, SectionDivider } from "@/components/cinema";
import { CompanyNewsFeed } from "@/components/news/CompanyNewsFeed";
import { NewsFeed } from "@/components/news/NewsFeed";
import { usePhoto } from "@/lib/cinema-theme";

export const Route = createFileRoute("/news")({
  component: NewsPage,
  head: () => ({
    meta: [
      { title: "Career-Buddy — News" },
      {
        name: "description",
        content:
          "Your daily feed of the best-fit roles. Fresh openings ranked against your CV, refreshed every night.",
      },
    ],
  }),
});

/**
 * F1 — News v1. A daily-return loop: the best-fit roles posted today
 * / this week / since the user last looked. Ranked client-side
 * against the persisted profile. Company news (F3) renders below the
 * top-jobs feed.
 */
function NewsPage() {
  const heroImage = usePhoto("jobs");
  return (
    <div className="bg-cinema-cream text-cinema-ink">
      <CinematicHero
        image={heroImage}
        altText="Daily news — the freshest roles that fit you"
        eyebrow="News"
        scrollVh={5}
        headline={<>The best new roles for you.</>}
        subhead={
          <>
            Every night we re-scan thousands of live openings and surface
            the ones that fit your CV. Today, this week, or everything
            new since you last looked.
          </>
        }
      />
      <SectionDivider from="cream" to="white" />
      <div className="bg-white">
        <NewsFeed />
        <CompanyNewsFeed />
      </div>
    </div>
  );
}
