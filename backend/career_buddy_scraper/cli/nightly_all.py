"""Nightly orchestrator — the single launchd entry point.

Runs on the user's MacBook via ``com.career-buddy.nightly.plist`` (see
``WORKPLAN`` cron section). Chains the independent nightly jobs; a
failure in one step is logged and the remaining steps still run, so a
flaky ATS scrape never blocks the news refresh.

Steps:
  1. ATS job scrape (existing orchestrator).
  2. F3 company-news RSS scrape.
  3. F3 archive cron — mark >90-day-old news as archived.

Later: F1.1 user-feed cache warm and F4 pending-token cleanup slot in
here as steps 1.5 and 4.

Usage::

    uv run python -m career_buddy_scraper.cli.nightly_all
"""

from __future__ import annotations

import asyncio
import logging
import sys

from ..news.google_news_rss import archive_old_news
from ..news.google_news_rss import run as run_news
from ..orchestrator import run_scrape

log = logging.getLogger("nightly_all")


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    failures = 0

    log.info("step 1/3 — ATS job scrape")
    try:
        scrape_stats = asyncio.run(run_scrape())
        log.info("scrape done: %s", scrape_stats)
    except Exception as e:
        failures += 1
        log.error("scrape step failed: %s", e)

    log.info("step 2/3 — company-news RSS scrape")
    try:
        news_stats = run_news()
        log.info("news done: %s", news_stats)
    except Exception as e:
        failures += 1
        log.error("news step failed: %s", e)

    log.info("step 3/3 — archive stale company news")
    try:
        archived = archive_old_news()
        log.info("archived %d stale news rows", archived)
    except Exception as e:
        failures += 1
        log.error("archive step failed: %s", e)

    if failures:
        log.warning("nightly_all finished with %d failed step(s)", failures)
        return 1
    log.info("nightly_all finished cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
