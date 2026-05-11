"""RemoteOK aggregator-adapter tests.

Coverage:
- detect() matches remoteok.com, rejects unrelated hosts.
- fetch() drops the legal-stub first element, returns the rest.
- fetch() returns [] on non-200.
- normalize() pulls company from raw (not from the VC row) and
  marks every job is_remote=True.
- normalize() derives a per-company domain from apply_url when it
  points at a real company host (greenhouse/lever/ashby/custom),
  otherwise falls back to ``<name>.remoteok-aggregator``.
- normalize() parses epoch + ISO date fields.
"""

from __future__ import annotations

from datetime import date, datetime

import httpx
import pytest
import respx

from career_buddy_scraper.ats.remoteok import RemoteOkAdapter
from career_buddy_scraper.http import RateLimitedClient, TokenBucket
from career_buddy_scraper.models import AtsSource, CanonicalJob


def test_detect_matches_remoteok() -> None:
    assert RemoteOkAdapter().detect("https://remoteok.com") == "remoteok"
    assert RemoteOkAdapter().detect("https://www.remoteok.com/remote-jobs") == "remoteok"


def test_detect_rejects_unrelated() -> None:
    assert RemoteOkAdapter().detect("https://boards.greenhouse.io/stripe") is None


def test_normalize_uses_raw_company_not_vc_row() -> None:
    raw = {
        "position": "Senior Engineer",
        "company": "ACME Inc",
        "url": "https://remoteok.com/jobs/12345",
        "apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "location": "Worldwide",
        "epoch": 1_700_000_000,
        "id": "12345",
    }
    out = RemoteOkAdapter().normalize(raw, "DiscardedVcName", "discarded.vc")
    assert out["company_name"] == "ACME Inc"
    assert out["company_domain"] == "boards.greenhouse.io"
    assert out["is_remote"] is True
    assert out["ats_source"] == AtsSource.REMOTEOK.value
    assert out["url"] == "https://remoteok.com/jobs/12345"
    CanonicalJob.model_validate(out)


def test_normalize_falls_back_to_aggregator_domain() -> None:
    raw = {
        "position": "Eng",
        "company": "Aisles & Abroad",
        "url": "https://remoteok.com/jobs/x",
        "apply_url": "https://remoteok.com/r/123",
        "location": "Remote",
        "epoch": 1_700_000_000,
    }
    out = RemoteOkAdapter().normalize(raw, "vc", "vc.com")
    # apply_url host is the aggregator itself → use sanitised company name
    assert out["company_domain"].endswith(".remoteok-aggregator")
    assert "aisles" in out["company_domain"]


def test_normalize_parses_epoch() -> None:
    raw = {
        "position": "Eng",
        "company": "X",
        "url": "https://remoteok.com/jobs/x",
        "epoch": 1_700_000_000,
    }
    out = RemoteOkAdapter().normalize(raw, "vc", "vc.com")
    assert out["posted_date"] == datetime.utcfromtimestamp(1_700_000_000).date()


@pytest.mark.asyncio
async def test_fetch_drops_legal_stub() -> None:
    legal_stub = {"last_updated": 1, "legal": "Terms of service..."}
    job1 = {"id": "a", "position": "Eng A", "company": "X", "url": "u1"}
    job2 = {"id": "b", "position": "Eng B", "company": "Y", "url": "u2"}
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://remoteok.com/api").respond(200, json=[legal_stub, job1, job2])
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await RemoteOkAdapter().fetch("ignored", client)
    assert len(rows) == 2
    assert rows[0]["id"] == "a"
    assert rows[1]["id"] == "b"


@pytest.mark.asyncio
async def test_fetch_returns_empty_on_non_200() -> None:
    async with respx.mock(assert_all_called=False) as router:
        router.get("https://remoteok.com/api").respond(503, text="busy")
        async with httpx.AsyncClient() as inner:
            client = RateLimitedClient(
                bucket=TokenBucket(100, 60.0),
                per_host_delay_s=0.0,
                client=inner,
            )
            rows = await RemoteOkAdapter().fetch("ignored", client)
    assert rows == []
