"""Ashby public job-board adapter.

Endpoint:  https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
Detection: ``jobs.ashbyhq.com/<slug>`` patterns.
Auth:      none.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
SLUG_PATTERN = re.compile(r"jobs\.ashbyhq\.com/(?P<slug>[a-z0-9-]+)", re.I)


class AshbyAdapter:
    source: AtsSource = AtsSource.ASHBY

    def detect(self, careers_url: str) -> str | None:
        host_and_path = urlparse(careers_url).netloc + urlparse(careers_url).path
        match = SLUG_PATTERN.search(host_and_path)
        return match.group("slug").lower() if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = ASHBY_API.format(slug=slug)
        resp = await client.get(url)
        resp.raise_for_status()
        payload = cast(dict[str, Any], resp.json())
        jobs = payload.get("jobs", [])
        return list(jobs) if isinstance(jobs, list) else []

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        title = str(raw.get("title", "")).strip()
        url = str(raw.get("jobUrl", ""))
        location = str(raw.get("location", "")) or None
        employment_type = str(raw.get("employmentType")) if raw.get("employmentType") else None
        published_raw = raw.get("publishedAt")
        posted_date = _parse_iso_date(published_raw if isinstance(published_raw, str) else None)
        is_remote_obj = raw.get("isRemote")
        is_remote = bool(is_remote_obj) if isinstance(is_remote_obj, bool) else False
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": title,
            "location": location,
            "is_remote": is_remote,
            "employment_type": employment_type,
            "url": url,
            "posted_date": posted_date,
            "ats_source": self.source.value,
            "raw_payload": raw,
        }


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
