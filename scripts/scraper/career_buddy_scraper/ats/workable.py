"""Workable public job-board adapter, with pagination.

Endpoint:  https://apply.workable.com/api/v3/accounts/<slug>/jobs (POST)
Detection: ``apply.workable.com/<slug>`` patterns.
Auth:      none.

Pagination contract (workplan v6 Step 2c, per Codex 3 finding 4):

- POST body: ``{"limit": 100}`` for page 1; subsequent pages add
  ``{"nextPage": <token>}``.
- Stop when the response has no ``nextPage`` key, ``nextPage`` is falsy,
  the same token has already been seen this run (loop guard), or the
  ``MAX_PAGES`` cap is reached.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

WORKABLE_API = "https://apply.workable.com/api/v3/accounts/{slug}/jobs"
SLUG_PATTERN = re.compile(r"apply\.workable\.com/(?P<slug>[a-z0-9-]+)", re.I)
MAX_PAGES = 10


class WorkableAdapter:
    source: AtsSource = AtsSource.WORKABLE

    def detect(self, careers_url: str) -> str | None:
        host_and_path = urlparse(careers_url).netloc + urlparse(careers_url).path
        match = SLUG_PATTERN.search(host_and_path)
        return match.group("slug").lower() if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = WORKABLE_API.format(slug=slug)
        results: list[dict[str, Any]] = []
        seen_tokens: set[str] = set()
        next_page: str | None = None
        for page_index in range(MAX_PAGES):
            body: dict[str, Any] = {"limit": 100}
            if next_page is not None:
                body["nextPage"] = next_page
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            payload = cast(dict[str, Any], resp.json())
            page_results = payload.get("results", [])
            if isinstance(page_results, list):
                results.extend(page_results)
            new_token = payload.get("nextPage")
            if not new_token or not isinstance(new_token, str):
                break
            if new_token in seen_tokens:
                break
            seen_tokens.add(new_token)
            next_page = new_token
            if page_index == MAX_PAGES - 1:
                break
        return results

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        title = str(raw.get("title", "")).strip()
        url = str(raw.get("url") or raw.get("application_url") or "")
        location_obj = raw.get("location")
        location = ""
        if isinstance(location_obj, dict):
            city = str(location_obj.get("city", ""))
            country = str(location_obj.get("country", ""))
            location = ", ".join(part for part in (city, country) if part)
        is_remote = bool(raw.get("remote"))
        employment_type = str(raw.get("employment_type")) if raw.get("employment_type") else None
        published_raw = raw.get("published")
        posted_date = _parse_iso_date(published_raw if isinstance(published_raw, str) else None)
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": title,
            "location": location or None,
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
