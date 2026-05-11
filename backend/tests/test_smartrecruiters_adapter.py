"""SmartRecruiters adapter unit tests.

Coverage:
- detect() preserves case (SR identifiers are case-sensitive).
- detect() rejects unrelated hosts.
- normalize() builds careers URL + flattens nested location.
- fetch() one-page-and-stop.
- fetch() walks offset until total reached.
- fetch() honours MAX_PAGES.
- fetch() stashes _sr_slug on every row.
- fetch() returns [] on 404 instead of raising.
- discover_ats preserves slug casing for embedded SR boards.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from career_buddy_scraper.ats.smartrecruiters import (
    MAX_PAGES,
    SmartRecruitersAdapter,
)
from career_buddy_scraper.discovery import discover_ats
from career_buddy_scraper.http import RateLimitedClient, TokenBucket
from career_buddy_scraper.models import AtsSource, CanonicalJob


def test_detect_preserves_case() -> None:
    out = SmartRecruitersAdapter().detect(
        "https://careers.smartrecruiters.com/ScalableCapital"
    )
    assert out == "ScalableCapital"
    out2 = SmartRecruitersAdapter().detect(
        "https://jobs.smartrecruiters.com/scalablegmbh"
    )
    assert out2 == "scalablegmbh"


def test_detect_returns_none_on_unrelated_host() -> None:
    assert (
        SmartRecruitersAdapter().detect("https://boards.greenhouse.io/stripe")
        is None
    )


def test_normalize_builds_url_and_flattens_location() -> None:
    raw = {
        "id": "744000122509268",
        "name": "Sr. SW Engineer",
        "releasedDate": "2026-04-23T16:54:54.835Z",
        "location": {
            "city": "Austin",
            "region": "TX",
            "country": "us",
            "remote": False,
        },
        "typeOfEmployment": {"id": "FT", "label": "Full-time"},
        "_sr_slug": "Visa",
    }
    out = SmartRecruitersAdapter().normalize(raw, "Visa", "visa.com")
    assert out["ats_source"] == AtsSource.SMARTRECRUITERS.value
    assert out["url"] == (
        "https://careers.smartrecruiters.com/Visa/744000122509268"
    )
    assert out["location"] == "Austin, TX, US"
    assert out["is_remote"] is False
    assert out["employment_type"] == "Full-time"
    CanonicalJob.model_validate(out)


def test_normalize_remote_flag() -> None:
    raw = {
        "id": "1",
        "name": "Remote Engineer",
        "location": {"remote": True, "country": "DE"},
        "_sr_slug": "scalablegmbh",
    }
    out = SmartRecruitersAdapter().normalize(raw, "Scalable", "scalable.capital")
    assert out["is_remote"] is True
    assert out["location"] == "DE"


@pytest.mark.asyncio
async def test_fetch_one_page() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get(
            "https://api.smartrecruiters.com/v1/companies/Visa/postings"
        ).respond(
            200,
            json={
                "offset": 0,
                "limit": 100,
                "totalFound": 2,
                "content": [
                    {"id": "a", "name": "Eng A"},
                    {"id": "b", "name": "Eng B"},
                ],
            },
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await SmartRecruitersAdapter().fetch("Visa", client)
    assert len(rows) == 2
    assert all(r["_sr_slug"] == "Visa" for r in rows)


@pytest.mark.asyncio
async def test_fetch_paginates() -> None:
    state = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if state["calls"] == 1:
            content = [{"id": f"a{i}", "name": "X"} for i in range(100)]
            return httpx.Response(
                200,
                json={"totalFound": 150, "content": content},
            )
        content = [{"id": f"b{i}", "name": "X"} for i in range(50)]
        return httpx.Response(
            200,
            json={"totalFound": 150, "content": content},
        )

    async with respx.mock(assert_all_called=False) as router:
        router.get(
            "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings"
        ).mock(side_effect=handler)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await SmartRecruitersAdapter().fetch("ServiceNow", client)
    assert state["calls"] == 2
    assert len(rows) == 150


@pytest.mark.asyncio
async def test_fetch_404_returns_empty() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get(
            "https://api.smartrecruiters.com/v1/companies/missing/postings"
        ).respond(404, json={"error": "not found"})
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await SmartRecruitersAdapter().fetch("missing", client)
    assert rows == []


@pytest.mark.asyncio
async def test_fetch_caps_at_max_pages() -> None:
    state = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        content = [
            {"id": f"x{state['calls']}-{i}", "name": "x"} for i in range(100)
        ]
        return httpx.Response(
            200,
            json={"totalFound": 100_000, "content": content},
        )

    async with respx.mock(assert_all_called=False) as router:
        router.get(
            "https://api.smartrecruiters.com/v1/companies/Huge/postings"
        ).mock(side_effect=handler)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await SmartRecruitersAdapter().fetch("Huge", client)
    assert state["calls"] == MAX_PAGES


@pytest.mark.asyncio
async def test_discover_ats_preserves_smartrecruiters_case() -> None:
    page = (
        '<html><body><a href="https://careers.smartrecruiters.com/'
        "ScalableCapital/jobs\">careers</a></body></html>"
    )
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://scalable.capital/careers").respond(200, html=page)
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            out = await discover_ats("https://scalable.capital/careers", client)
    assert out == ("smartrecruiters", "ScalableCapital")
