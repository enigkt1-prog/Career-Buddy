"""Greenhouse public job-board adapter.

Endpoint:  https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
Detection: ``boards.greenhouse.io/<slug>`` or ``<slug>.greenhouse.io`` patterns.
Auth:      none.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
SLUG_PATTERNS = [
    re.compile(r"boards\.greenhouse\.io/(?P<slug>[a-z0-9-]+)", re.I),
    re.compile(r"(?P<slug>[a-z0-9-]+)\.greenhouse\.io", re.I),
]


class GreenhouseAdapter:
    source: AtsSource = AtsSource.GREENHOUSE

    def detect(self, careers_url: str) -> str | None:
        host_and_path = urlparse(careers_url).netloc + urlparse(careers_url).path
        for pattern in SLUG_PATTERNS:
            match = pattern.search(host_and_path)
            if match:
                return match.group("slug").lower()
        return None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = GREENHOUSE_API.format(slug=slug)
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
        url = str(raw.get("absolute_url", ""))
        location_obj = raw.get("location")
        location = ""
        if isinstance(location_obj, dict):
            location = str(location_obj.get("name", ""))
        updated_raw = raw.get("updated_at")
        posted_date = _parse_iso_date(updated_raw if isinstance(updated_raw, str) else None)
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": title,
            "location": location or None,
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
