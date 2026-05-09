"""Recruitee public job-board adapter (DACH/EU 2nd-tier HRIS).

Endpoint:  https://<slug>.recruitee.com/api/offers/
Detection: ``<slug>.recruitee.com`` patterns.
Auth:      none.

Response is JSON; ``offers`` is a list of postings.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

RECRUITEE_API = "https://{slug}.recruitee.com/api/offers/"
SLUG_PATTERN = re.compile(r"(?P<slug>[a-z0-9-]+)\.recruitee\.com", re.I)


class RecruiteeAdapter:
    source: AtsSource = AtsSource.RECRUITEE

    def detect(self, careers_url: str) -> str | None:
        host = urlparse(careers_url).netloc
        match = SLUG_PATTERN.search(host)
        return match.group("slug").lower() if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = RECRUITEE_API.format(slug=slug)
        try:
            resp = await client.get(url)
        except Exception:
            return []
        if resp.status_code != 200:
            return []
        try:
            payload = cast(dict[str, Any], resp.json())
        except ValueError:
            return []
        offers = payload.get("offers", [])
        return list(offers) if isinstance(offers, list) else []

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        title = str(raw.get("title", "")).strip()
        url = str(raw.get("careers_url") or raw.get("url") or "")
        location = ", ".join(
            part
            for part in (
                str(raw.get("city", "")),
                str(raw.get("country", "")),
            )
            if part
        )
        employment_type = str(raw.get("employment_type")) if raw.get("employment_type") else None
        is_remote = bool(raw.get("remote"))
        published_raw = raw.get("published_at") or raw.get("created_at")
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
