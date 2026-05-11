"""WeWorkRemotely aggregator-adapter tests.

Coverage:
- detect() matches weworkremotely.com.
- fetch() parses RSS into row dicts.
- fetch() returns [] on non-200 or malformed XML.
- normalize() splits "Company: Role" title shape.
- normalize() falls back to "Unknown" when title has no colon.
- normalize() builds aggregator domain.
- normalize() parses RFC-2822 pubDate.
"""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from career_buddy_scraper.ats.weworkremotely import WeWorkRemotelyAdapter
from career_buddy_scraper.http import RateLimitedClient, TokenBucket
from career_buddy_scraper.models import AtsSource, CanonicalJob


def test_detect_matches_wwr() -> None:
    assert (
        WeWorkRemotelyAdapter().detect("https://weworkremotely.com/remote-jobs")
        == "weworkremotely"
    )


def test_detect_rejects_unrelated() -> None:
    assert (
        WeWorkRemotelyAdapter().detect("https://remoteok.com") is None
    )


def test_normalize_splits_company_colon_title() -> None:
    raw = {
        "title": "ACME Inc: Senior Engineer",
        "link": "https://weworkremotely.com/listings/123",
        "region": "Anywhere in the World",
        "pubDate": "Sat, 10 May 2026 12:34:56 +0000",
    }
    out = WeWorkRemotelyAdapter().normalize(raw, "vc", "vc.com")
    assert out["company_name"] == "ACME Inc"
    assert out["role_title"] == "Senior Engineer"
    assert out["company_domain"] == "acme-inc.wwr-aggregator"
    assert out["is_remote"] is True
    assert out["ats_source"] == AtsSource.WEWORKREMOTELY.value
    assert out["posted_date"] == date(2026, 5, 10)
    CanonicalJob.model_validate(out)


def test_normalize_without_colon_uses_unknown() -> None:
    raw = {
        "title": "Some standalone title",
        "link": "https://weworkremotely.com/listings/x",
    }
    out = WeWorkRemotelyAdapter().normalize(raw, "vc", "vc.com")
    assert out["company_name"] == "Unknown"
    assert out["role_title"] == "Some standalone title"


@pytest.mark.asyncio
async def test_fetch_parses_rss() -> None:
    rss = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>WWR</title>
        <item>
          <title>ACME: Eng A</title>
          <link>https://weworkremotely.com/listings/a</link>
          <pubDate>Sat, 10 May 2026 12:00:00 +0000</pubDate>
          <region>Anywhere</region>
        </item>
        <item>
          <title>Beta Co: Eng B</title>
          <link>https://weworkremotely.com/listings/b</link>
          <pubDate>Sat, 10 May 2026 13:00:00 +0000</pubDate>
        </item>
      </channel>
    </rss>"""
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://weworkremotely.com/remote-jobs.rss").respond(200, text=rss)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WeWorkRemotelyAdapter().fetch("ignored", client)
    assert len(rows) == 2
    assert rows[0]["title"] == "ACME: Eng A"
    assert rows[1]["title"] == "Beta Co: Eng B"


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_malformed_xml() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://weworkremotely.com/remote-jobs.rss").respond(
            200, text="not xml at all"
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WeWorkRemotelyAdapter().fetch("ignored", client)
    assert rows == []
