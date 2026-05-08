"""Lever public job-board adapter.

Endpoint:  https://api.lever.co/v0/postings/<slug>?mode=json
Detection: ``jobs.lever.co/<slug>`` patterns.
Auth:      none.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

LEVER_API = "https://api.lever.co/v0/postings/{slug}?mode=json"
SLUG_PATTERN = re.compile(r"jobs\.lever\.co/(?P<slug>[a-z0-9-]+)", re.I)


class LeverAdapter:
    source: AtsSource = AtsSource.LEVER

    def detect(self, careers_url: str) -> str | None:
        host_and_path = urlparse(careers_url).netloc + urlparse(careers_url).path
        match = SLUG_PATTERN.search(host_and_path)
        return match.group("slug").lower() if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = LEVER_API.format(slug=slug)
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()
        return list(payload) if isinstance(payload, list) else []

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        title = str(raw.get("text", "")).strip()
        url = str(raw.get("hostedUrl", ""))
        categories = raw.get("categories")
        location = ""
        commitment: str | None = None
        if isinstance(categories, dict):
            location = str(categories.get("location", ""))
            commitment = str(categories.get("commitment")) if categories.get("commitment") else None
        created_at_ms = raw.get("createdAt")
        posted_date: date | None = None
        if isinstance(created_at_ms, (int, float)):
            posted_date = datetime.fromtimestamp(created_at_ms / 1000, tz=UTC).date()
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": title,
            "location": location or None,
            "employment_type": commitment,
            "url": url,
            "posted_date": posted_date,
            "ats_source": self.source.value,
            "raw_payload": raw,
        }
