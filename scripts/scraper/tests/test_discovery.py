"""HTML-discovery tests."""

from __future__ import annotations

import httpx
import pytest
import respx

from career_buddy_scraper.discovery import discover_ats
from career_buddy_scraper.http import RateLimitedClient, TokenBucket

GREENHOUSE_HTML = """
<html><body>
  <iframe src="https://boards.greenhouse.io/cherryventures"></iframe>
</body></html>
"""

LEVER_HTML = """
<html><body>
  <a href="https://jobs.lever.co/example-co">Open roles</a>
</body></html>
"""

NO_ATS_HTML = """
<html><body>
  <h1>Welcome</h1>
  <p>We are not hiring right now.</p>
</body></html>
"""


@pytest.mark.asyncio
async def test_discover_finds_greenhouse_iframe() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://example.com/careers").respond(200, html=GREENHOUSE_HTML)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            result = await discover_ats("https://example.com/careers", client)
    assert result == ("greenhouse", "cherryventures")


@pytest.mark.asyncio
async def test_discover_finds_lever_link() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://example2.com/careers").respond(200, html=LEVER_HTML)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            result = await discover_ats("https://example2.com/careers", client)
    assert result == ("lever", "example-co")


@pytest.mark.asyncio
async def test_discover_returns_none_when_no_ats_in_html() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://example3.com/careers").respond(200, html=NO_ATS_HTML)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            result = await discover_ats("https://example3.com/careers", client)
    assert result is None


@pytest.mark.asyncio
async def test_discover_returns_none_on_4xx() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://example4.com/careers").respond(404)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            result = await discover_ats("https://example4.com/careers", client)
    assert result is None
