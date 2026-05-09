"""Gemini fallback adapter for sites without a known ATS provider.

Used by the orchestrator when ``_resolve_provider`` returns None
(no Greenhouse/Lever/Ashby/Workable/Personio/Recruitee match).

Cost discipline:
- Gated by env var ``GEMINI_FALLBACK_ENABLED=1`` (default: off — opt-in).
- Hard soft-cap: ``GEMINI_FALLBACK_MAX_PER_RUN`` (default: 50) — stops eating Free
  Tier quota if many VCs are unmatched.
- Internal fallback chain: Free API → ``gemini`` CLI → STOP. Never auto-pays.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

from ..gemini_scraper import GeminiScraper, QuotaExhausted
from ..http import RateLimitedClient
from ..models import AtsSource, CanonicalJob

log = logging.getLogger(__name__)

DEFAULT_MAX_PER_RUN = 50


def is_enabled() -> bool:
    return os.environ.get("GEMINI_FALLBACK_ENABLED", "").lower() in ("1", "true", "yes", "on")


def max_per_run() -> int:
    raw = os.environ.get("GEMINI_FALLBACK_MAX_PER_RUN", str(DEFAULT_MAX_PER_RUN))
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_MAX_PER_RUN


class GeminiFallbackBudget:
    """Per-run counter to enforce ``GEMINI_FALLBACK_MAX_PER_RUN``."""

    def __init__(self, cap: int | None = None) -> None:
        self.cap = cap if cap is not None else max_per_run()
        self.used = 0

    def take(self) -> bool:
        if self.used >= self.cap:
            return False
        self.used += 1
        return True


async def try_gemini_extract(
    careers_url: str,
    company_name: str,
    company_domain: str,
    client: RateLimitedClient,
    budget: GeminiFallbackBudget,
    scraper: GeminiScraper | None = None,
) -> tuple[list[CanonicalJob], str | None]:
    """Run Gemini fallback. Returns ``(jobs, error_or_none)``.

    On budget-exhaustion / quota / parse failures: returns ``([], reason)``.
    On success: returns ``(jobs, None)``.
    """
    if not budget.take():
        return [], f"budget exhausted (cap={budget.cap})"

    try:
        resp = await client.get(careers_url, follow_redirects=True)
    except Exception as e:
        return [], f"http fetch failed: {type(e).__name__}: {e}"
    if resp.status_code >= 400:
        return [], f"http {resp.status_code}"

    html = resp.text
    if not html:
        return [], "empty html"

    scraper = scraper or GeminiScraper()
    try:
        raw_jobs = scraper.extract_jobs(html, careers_url)
    except QuotaExhausted as e:
        return [], f"all gemini tiers exhausted: {e}"
    except Exception as e:
        return [], f"gemini error: {type(e).__name__}: {e}"

    jobs: list[CanonicalJob] = []
    for raw in raw_jobs:
        try:
            jobs.append(_normalize(raw, careers_url, company_name, company_domain))
        except Exception as e:
            log.warning("gemini fallback skip row for %s: %s", company_domain, e)
            continue
    return jobs, None


def _normalize(
    raw: dict[str, Any],
    source_url: str,
    company_name: str,
    company_domain: str,
) -> CanonicalJob:
    """Map Gemini raw-dict → CanonicalJob. Adapter-equivalent for orchestrator pattern."""
    role_title = raw.get("role_title") or raw.get("title")
    if not role_title or not isinstance(role_title, str):
        raise ValueError("missing role_title")

    job_url = raw.get("url") or source_url
    if not isinstance(job_url, str):
        raise ValueError("missing url")
    if not job_url.startswith(("http://", "https://")):
        # Resolve relative URL against source
        parsed = urlparse(source_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        job_url = f"{base}{job_url if job_url.startswith('/') else '/' + job_url}"

    posted_date: date | None = None
    posted_raw = raw.get("posted_date")
    if isinstance(posted_raw, str):
        try:
            posted_date = datetime.fromisoformat(posted_raw).date()
        except ValueError:
            try:
                posted_date = date.fromisoformat(posted_raw)
            except ValueError:
                posted_date = None

    return CanonicalJob(
        company_name=raw.get("company_name") or company_name,
        company_domain=company_domain,
        role_title=role_title.strip(),
        location=raw.get("location"),
        is_remote=bool(raw.get("is_remote", False)),
        employment_type=raw.get("employment_type"),
        url=job_url,  # type: ignore[arg-type]
        description=raw.get("description"),
        posted_date=posted_date,
        ats_source=AtsSource.CUSTOM,
        raw_payload={"gemini_raw": raw, "source_url": source_url},
    )
