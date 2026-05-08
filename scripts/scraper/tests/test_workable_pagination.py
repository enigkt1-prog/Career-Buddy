"""Workable pagination tests: 1-page, 2-page, cap-hit, repeated-token guard."""

from __future__ import annotations

import httpx
import pytest
import respx

from career_buddy_scraper.ats.workable import MAX_PAGES, WorkableAdapter
from career_buddy_scraper.http import RateLimitedClient, TokenBucket


@pytest.mark.asyncio
async def test_workable_one_page_no_next_token() -> None:
    async with respx.mock(assert_all_called=False) as router:
        route = router.post("https://apply.workable.com/api/v3/accounts/sample/jobs").respond(
            200, json={"results": [{"title": "FA"}], "nextPage": None}
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WorkableAdapter().fetch("sample", client)
    assert len(rows) == 1
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_workable_two_pages_then_stop() -> None:
    state = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if state["calls"] == 1:
            return httpx.Response(
                200,
                json={"results": [{"title": "FA-1"}], "nextPage": "tok-2"},
            )
        return httpx.Response(
            200,
            json={"results": [{"title": "FA-2"}], "nextPage": None},
        )

    async with respx.mock(assert_all_called=False) as router:
        router.post("https://apply.workable.com/api/v3/accounts/sample/jobs").mock(
            side_effect=handler
        )
        # Use a fresh client per test to avoid cache hits
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WorkableAdapter().fetch("sample", client)
    assert state["calls"] == 2
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_workable_cap_at_max_pages() -> None:
    state = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        return httpx.Response(
            200,
            json={
                "results": [{"title": f"FA-{state['calls']}"}],
                # always return a fresh distinct token, would loop forever
                "nextPage": f"tok-{state['calls']}",
            },
        )

    async with respx.mock(assert_all_called=False) as router:
        router.post("https://apply.workable.com/api/v3/accounts/sample/jobs").mock(
            side_effect=handler
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WorkableAdapter().fetch("sample", client)
    assert state["calls"] == MAX_PAGES
    assert len(rows) == MAX_PAGES


@pytest.mark.asyncio
async def test_workable_repeated_token_guard() -> None:
    state = {"calls": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        # Same token every time would loop forever without guard
        return httpx.Response(
            200,
            json={"results": [{"title": f"FA-{state['calls']}"}], "nextPage": "loop"},
        )

    async with respx.mock(assert_all_called=False) as router:
        router.post("https://apply.workable.com/api/v3/accounts/sample/jobs").mock(
            side_effect=handler
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WorkableAdapter().fetch("sample", client)
    # First call returns nextPage="loop", we follow once, then on the second
    # fetch we see "loop" already in seen_tokens → break. Total: 2 calls.
    assert state["calls"] == 2
    assert len(rows) == 2
