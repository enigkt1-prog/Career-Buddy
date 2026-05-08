"""Adapter-contract tests: fetch shape, normalize shape, no httpx import.

Per workplan v6 Step 2c (Codex 3 finding 3): each provider's adapter must
return raw dicts and use only the injected ``RateLimitedClient`` for HTTP.
"""

from __future__ import annotations

import inspect
from typing import Any

import httpx
import pytest
import respx

from career_buddy_scraper.ats import ashby, greenhouse, lever, workable
from career_buddy_scraper.ats.ashby import AshbyAdapter
from career_buddy_scraper.ats.greenhouse import GreenhouseAdapter
from career_buddy_scraper.ats.lever import LeverAdapter
from career_buddy_scraper.ats.workable import WorkableAdapter
from career_buddy_scraper.http import RateLimitedClient, TokenBucket
from career_buddy_scraper.models import CanonicalJob

REQUIRED_KEYS = {"company_name", "company_domain", "role_title", "url", "ats_source"}

ADAPTER_MODULES = (greenhouse, lever, ashby, workable)


@pytest.mark.parametrize("module", ADAPTER_MODULES)
def test_no_direct_httpx_import_in_fetch_source(module: Any) -> None:
    """fetch() may not import httpx in its module — must use injected client."""
    src = inspect.getsource(module)
    assert "import httpx" not in src, f"{module.__name__} imports httpx directly"
    assert "from httpx" not in src, f"{module.__name__} imports from httpx directly"


@pytest.mark.asyncio
async def test_greenhouse_fetch_returns_list_of_dicts() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://boards-api.greenhouse.io/v1/boards/sample/jobs?content=true").respond(
            200, json={"jobs": [{"title": "Founders Associate"}]}
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await GreenhouseAdapter().fetch("sample", client)
    assert isinstance(rows, list)
    assert all(isinstance(r, dict) for r in rows)


@pytest.mark.asyncio
async def test_lever_fetch_returns_list_of_dicts() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://api.lever.co/v0/postings/sample?mode=json").respond(
            200, json=[{"text": "Strategy Associate"}]
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await LeverAdapter().fetch("sample", client)
    assert isinstance(rows, list) and all(isinstance(r, dict) for r in rows)


@pytest.mark.asyncio
async def test_ashby_fetch_returns_list_of_dicts() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get(
            "https://api.ashbyhq.com/posting-api/job-board/sample?includeCompensation=true"
        ).respond(200, json={"jobs": [{"title": "BizOps Lead"}]})
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await AshbyAdapter().fetch("sample", client)
    assert isinstance(rows, list) and all(isinstance(r, dict) for r in rows)


@pytest.mark.asyncio
async def test_workable_fetch_returns_list_of_dicts() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.post("https://apply.workable.com/api/v3/accounts/sample/jobs").respond(
            200, json={"results": [{"title": "Investment Analyst"}]}
        )
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await WorkableAdapter().fetch("sample", client)
    assert isinstance(rows, list) and all(isinstance(r, dict) for r in rows)


def test_greenhouse_normalize_returns_dict_with_required_keys() -> None:
    raw = {
        "title": "Founders Associate",
        "absolute_url": "https://boards.greenhouse.io/cherryventures/jobs/123",
        "location": {"name": "Berlin, Germany"},
        "updated_at": "2026-04-01T10:00:00Z",
    }
    out = GreenhouseAdapter().normalize(raw, "Cherry Ventures", "cherry.vc")
    assert isinstance(out, dict)
    assert REQUIRED_KEYS.issubset(out.keys())
    CanonicalJob.model_validate(out)  # round-trips into Pydantic


def test_lever_normalize_returns_dict_with_required_keys() -> None:
    raw = {
        "text": "Strategy Associate",
        "hostedUrl": "https://jobs.lever.co/example/abc-123",
        "categories": {"location": "London", "commitment": "Full-time"},
        "createdAt": 1_700_000_000_000,
    }
    out = LeverAdapter().normalize(raw, "Example", "example.com")
    assert REQUIRED_KEYS.issubset(out.keys())
    CanonicalJob.model_validate(out)


def test_ashby_normalize_returns_dict_with_required_keys() -> None:
    raw = {
        "title": "BizOps Lead",
        "jobUrl": "https://jobs.ashbyhq.com/example/role-id",
        "location": "Remote (EU)",
        "isRemote": True,
        "employmentType": "FullTime",
        "publishedAt": "2026-04-15T09:00:00Z",
    }
    out = AshbyAdapter().normalize(raw, "Example", "example.com")
    assert REQUIRED_KEYS.issubset(out.keys())
    CanonicalJob.model_validate(out)


def test_workable_normalize_returns_dict_with_required_keys() -> None:
    raw = {
        "title": "Investment Analyst",
        "url": "https://apply.workable.com/example/j/abc",
        "location": {"city": "Berlin", "country": "Germany"},
        "remote": False,
        "employment_type": "full",
        "published": "2026-04-20T12:00:00Z",
    }
    out = WorkableAdapter().normalize(raw, "Example", "example.com")
    assert REQUIRED_KEYS.issubset(out.keys())
    CanonicalJob.model_validate(out)


def test_invalid_raw_round_trips_to_validation_error_not_crash() -> None:
    """A raw with empty url normalises to a dict; Pydantic raises on validate."""
    bad = {"title": "", "absolute_url": "", "location": None, "updated_at": None}
    from pydantic import ValidationError

    out = GreenhouseAdapter().normalize(bad, "Example", "example.com")
    assert isinstance(out, dict)
    with pytest.raises(ValidationError):
        CanonicalJob.model_validate(out)
