import { ArrowUpRight, MessageCircle } from "lucide-react";

import { relativeTime, type CompanyNewsItem } from "@/lib/company-news";
import { track } from "@/lib/telemetry";

/**
 * F3 — a single company-news headline card. Headline opens the article;
 * "Ask Buddy" dispatches the `open-buddy` event so the floating panel
 * opens pre-seeded with a question about what the news means for the
 * user's interest in that company.
 */
export function CompanyNewsCard({ item }: { item: CompanyNewsItem }) {
  function openArticle() {
    void track("company_news_card_click", {
      newsId: item.id,
      company: item.company_name,
    });
    window.open(item.url, "_blank", "noopener,noreferrer");
  }

  function askBuddy() {
    window.dispatchEvent(
      new CustomEvent("open-buddy", {
        detail: {
          prefill: `News on ${item.company_name}: "${item.headline}". What does this mean for my interest in working there?`,
        },
      }),
    );
  }

  return (
    <div className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition">
      <div className="flex items-center gap-2 text-cinema-caption text-cinema-ink-mute mb-2 flex-wrap">
        <span className="font-medium text-cinema-ink-soft">
          {item.company_name}
        </span>
        {item.source && (
          <>
            <span aria-hidden>·</span>
            <span>{item.source}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <time dateTime={item.published_at}>{relativeTime(item.published_at)}</time>
      </div>

      <button
        type="button"
        onClick={openArticle}
        className="group text-left flex items-start gap-1.5 text-cinema-body font-medium text-cinema-ink hover:text-cinema-moss transition-colors"
      >
        <span>{item.headline}</span>
        <ArrowUpRight className="w-4 h-4 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
      </button>

      {item.summary && (
        <p className="mt-2 text-cinema-body text-cinema-ink-soft line-clamp-3">
          {item.summary}
        </p>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={askBuddy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-cinema-caption text-cinema-ink-soft hover:bg-cinema-mint/60 transition-colors"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Ask Buddy
        </button>
      </div>
    </div>
  );
}
