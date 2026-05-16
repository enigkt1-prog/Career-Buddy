import { useEffect } from "react";
import { Loader2 } from "lucide-react";

import { CompanyNewsCard } from "@/components/news/CompanyNewsCard";
import { TargetCompaniesInput } from "@/components/news/TargetCompaniesInput";
import { useCompanyNews, type CompanyNewsItem } from "@/lib/company-news";
import { track } from "@/lib/telemetry";

/**
 * F3 — News v2. Company-news block that sits below the F1 top-jobs
 * feed on /news. Two sections:
 *  - news for companies the user has applied to;
 *  - news for companies on the user's watch-list.
 *
 * The catalog is cron-populated nightly; this component is read-only
 * over the `news-feed` edge function. The watch-list editor is
 * rendered inline so the whole company-news surface lives on /news.
 */

function NewsSection({
  title,
  emptyHint,
  items,
}: {
  title: string;
  emptyHint: string;
  items: CompanyNewsItem[];
}) {
  return (
    <div>
      <h3 className="text-cinema-body font-medium text-cinema-ink mb-3">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-cinema-caption text-cinema-ink-mute">{emptyHint}</p>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <CompanyNewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CompanyNewsFeed() {
  const { data, isLoading, isError } = useCompanyNews();

  useEffect(() => {
    void track("company_news_view");
  }, []);

  return (
    <section className="max-w-5xl mx-auto px-6 md:px-12 py-12 border-t border-cinema-mint">
      <div className="mb-2 text-cinema-eyebrow text-cinema-moss">
        Company news
      </div>
      <h2 className="text-cinema-h2 text-cinema-ink mb-6">
        What's happening where you're applying.
      </h2>

      <div className="mb-8">
        <TargetCompaniesInput />
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-cinema-ink-mute py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading company news…
        </div>
      )}

      {isError && (
        <div className="rounded-glass border border-red-200 bg-red-50 px-4 py-3 text-cinema-body text-destructive">
          Couldn't load company news. Try again in a moment.
        </div>
      )}

      {!isLoading && !isError && data && (
        <div className="grid gap-10">
          <NewsSection
            title="From companies you've applied to"
            emptyHint="No recent news from your applications. News appears once you've tracked an application and the nightly scan finds a story."
            items={data.applied_news}
          />
          <NewsSection
            title="From companies you're watching"
            emptyHint="No recent news from your watch-list. Add companies above — their news lands in tomorrow's feed."
            items={data.target_news}
          />
        </div>
      )}
    </section>
  );
}
