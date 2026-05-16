"""Unit tests for the company-news RSS scraper (F3 — News v2).

Covers the pure pipeline — RSS parsing, dedupe, and the heuristic-first
relevance filter with a stubbed LLM. No live network or DB.
"""

from __future__ import annotations

from career_buddy_scraper.news.google_news_rss import (
    classify_relevance,
    dedupe,
    domain_blocked,
    extract_items,
    google_news_url,
    mentions_company,
    process_company,
    select_relevant,
    title_hash,
)

# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def _rss(*items: str) -> str:
    body = "\n".join(items)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>News</title>
{body}
</channel></rss>"""


def _item(
    title: str,
    link: str,
    *,
    source: str = "TechCrunch",
    source_url: str = "https://techcrunch.com",
    pub: str = "Wed, 14 May 2026 10:30:00 GMT",
    desc: str = "&lt;a href='x'&gt;snippet text&lt;/a&gt;",
) -> str:
    return f"""<item>
  <title>{title}</title>
  <link>{link}</link>
  <pubDate>{pub}</pubDate>
  <description>{desc}</description>
  <source url="{source_url}">{source}</source>
</item>"""


class FakeLLM:
    """Stand-in for ClaudeCli — records calls, returns a scripted verdict."""

    def __init__(self, relevant: bool = True) -> None:
        self._relevant = relevant
        self.calls = 0

    def query_json(self, prompt: str, timeout: int = 60) -> dict:
        self.calls += 1
        return {"relevant": self._relevant}


# --------------------------------------------------------------------------
# title_hash
# --------------------------------------------------------------------------


def test_title_hash_normalises_case_and_whitespace() -> None:
    assert title_hash("Stripe Raises $1B") == title_hash("  stripe   raises $1b ")


def test_title_hash_differs_for_distinct_headlines() -> None:
    assert title_hash("Stripe raises funding") != title_hash("Notion ships AI")


# --------------------------------------------------------------------------
# google_news_url
# --------------------------------------------------------------------------


def test_google_news_url_quotes_and_encodes_company() -> None:
    url = google_news_url("Acme Corp")
    assert url.startswith("https://news.google.com/rss/search?q=")
    # Exact-phrase quotes are URL-encoded; the space is encoded too.
    assert "%22Acme%20Corp%22" in url


# --------------------------------------------------------------------------
# mentions_company / domain_blocked
# --------------------------------------------------------------------------


def test_mentions_company_word_boundary() -> None:
    assert mentions_company("Stripe launches new API", "Stripe")
    assert mentions_company("news from STRIPE today", "stripe")
    # Substring of a larger word must not match.
    assert not mentions_company("Stripeless design trends", "Stripe")


def test_domain_blocked_matches_blocklist_and_subdomains() -> None:
    assert domain_blocked("https://www.reddit.com/r/startups")
    assert domain_blocked("https://old.reddit.com/x")
    assert domain_blocked("https://news.ycombinator.com/item")
    assert not domain_blocked("https://techcrunch.com/article")
    assert not domain_blocked(None)


# --------------------------------------------------------------------------
# classify_relevance
# --------------------------------------------------------------------------


def test_classify_pass_when_company_named_on_clean_domain() -> None:
    verdict = classify_relevance(
        "Stripe raises a new round", "Stripe", "https://techcrunch.com"
    )
    assert verdict == "pass"


def test_classify_reject_on_noise_headline() -> None:
    verdict = classify_relevance(
        "Top 10 startups to watch in 2026", "Stripe", "https://techcrunch.com"
    )
    assert verdict == "reject"


def test_classify_reject_on_blocked_domain() -> None:
    verdict = classify_relevance(
        "Stripe discussion thread", "Stripe", "https://reddit.com"
    )
    # noise ("thread") fires first, but a blocked domain alone also rejects:
    verdict2 = classify_relevance(
        "Some Stripe update", "Stripe", "https://reddit.com"
    )
    assert verdict == "reject"
    assert verdict2 == "reject"


def test_classify_borderline_when_company_absent() -> None:
    verdict = classify_relevance(
        "Fintech sector sees record investment", "Stripe", "https://techcrunch.com"
    )
    assert verdict == "borderline"


# --------------------------------------------------------------------------
# extract_items
# --------------------------------------------------------------------------


def test_extract_items_parses_feed() -> None:
    xml = _rss(
        _item("Stripe raises $1B - TechCrunch", "https://news.google.com/a"),
        _item("Notion ships AI - The Verge", "https://news.google.com/b"),
    )
    items = extract_items("Stripe", xml)
    assert len(items) == 2
    # Publisher suffix stripped from the headline.
    assert items[0].headline == "Stripe raises $1B"
    assert items[0].source == "TechCrunch"
    assert items[0].company_name == "Stripe"
    assert items[0].summary == "snippet text"
    assert items[0].published_at.year == 2026


def test_extract_items_skips_items_without_title_or_link() -> None:
    xml = _rss(
        "<item><link>https://x/1</link></item>",
        _item("Real headline - TechCrunch", "https://x/2"),
    )
    items = extract_items("Stripe", xml)
    assert len(items) == 1


def test_extract_items_returns_empty_on_garbage_xml() -> None:
    assert extract_items("Stripe", "<not-xml") == []


# --------------------------------------------------------------------------
# dedupe
# --------------------------------------------------------------------------


def test_dedupe_collapses_same_headline_and_same_url() -> None:
    xml = _rss(
        _item("Stripe raises $1B - TechCrunch", "https://x/1"),
        # Same headline, different URL → collapsed by title_hash.
        _item("stripe raises $1b - Reuters", "https://x/2", source="Reuters"),
        # Distinct headline, same URL as #1 → collapsed by URL.
        _item("Stripe hires CFO - TechCrunch", "https://x/1"),
        _item("Stripe hires CFO - TechCrunch", "https://x/3"),
    )
    items = extract_items("Stripe", xml)
    deduped = dedupe(items)
    headlines = {it.headline.lower() for it in deduped}
    assert headlines == {"stripe raises $1b", "stripe hires cfo"}


# --------------------------------------------------------------------------
# select_relevant
# --------------------------------------------------------------------------


def test_select_relevant_keeps_pass_drops_reject() -> None:
    xml = _rss(
        _item("Stripe launches new product - TechCrunch", "https://x/1"),
        _item("Top 10 startups - TechCrunch", "https://x/2"),
    )
    items = extract_items("Stripe", xml)
    kept, calls = select_relevant(items, llm=None, llm_budget=0)
    assert [it.headline for it in kept] == ["Stripe launches new product"]
    assert calls == 0


def test_select_relevant_defers_borderline_to_llm() -> None:
    xml = _rss(_item("Fintech sector booms - TechCrunch", "https://x/1"))
    items = extract_items("Stripe", xml)
    llm = FakeLLM(relevant=True)
    kept, calls = select_relevant(items, llm=llm, llm_budget=5)
    assert calls == 1
    assert len(kept) == 1


def test_select_relevant_llm_rejects_borderline() -> None:
    xml = _rss(_item("Fintech sector booms - TechCrunch", "https://x/1"))
    items = extract_items("Stripe", xml)
    llm = FakeLLM(relevant=False)
    kept, calls = select_relevant(items, llm=llm, llm_budget=5)
    assert calls == 1
    assert kept == []


def test_select_relevant_respects_llm_budget() -> None:
    xml = _rss(
        _item("Fintech sector A - TechCrunch", "https://x/1"),
        _item("Fintech sector B - TechCrunch", "https://x/2"),
        _item("Fintech sector C - TechCrunch", "https://x/3"),
    )
    items = extract_items("Stripe", xml)
    llm = FakeLLM(relevant=True)
    kept, calls = select_relevant(items, llm=llm, llm_budget=1)
    # Budget caps the LLM at one call; remaining borderline items dropped.
    assert calls == 1
    assert len(kept) == 1


# --------------------------------------------------------------------------
# process_company
# --------------------------------------------------------------------------


def test_process_company_end_to_end() -> None:
    xml = _rss(
        _item("Stripe raises $1B - TechCrunch", "https://x/1"),
        _item("Stripe raises $1B - Reuters", "https://x/2", source="Reuters"),
        _item("Top 10 fintech lists - TechCrunch", "https://x/3"),
        _item("Generic market news - Reddit", "https://x/4",
              source="Reddit", source_url="https://reddit.com"),
    )
    kept, calls = process_company("Stripe", xml, llm=None, llm_budget=0)
    # Dupe collapsed, noise + blocked-domain rejected → one survivor.
    assert len(kept) == 1
    assert kept[0].headline == "Stripe raises $1B"
    assert calls == 0
