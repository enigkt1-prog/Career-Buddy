"""SmartRecruiters public job-board adapter.

Endpoint:  GET https://api.smartrecruiters.com/v1/companies/<id>/postings
Detection: ``jobs.smartrecruiters.com/<id>`` and
           ``careers.smartrecruiters.com/<id>`` URLs.
Auth:      none.

The company identifier is case-sensitive (``scalablegmbh`` ≠
``Scalable`` ≠ ``ScalableCapital``); we round-trip the case as
captured. Pagination is offset-based with a server-side 100-row max.
Each posting carries a ``ref`` UUID we turn into the public job-page
URL (``careers.smartrecruiters.com/<company>/<id>``).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

SR_API = "https://api.smartrecruiters.com/v1/companies/{slug}/postings"
JOB_URL = "https://careers.smartrecruiters.com/{slug}/{job_id}"
# Note: SmartRecruiters company slugs are case-sensitive — keep the
# captured casing intact (no .lower()).
SLUG_PATTERN = re.compile(
    r"(?:careers|jobs)\.smartrecruiters\.com/(?P<slug>[A-Za-z0-9_-]+)",
    re.I,
)
PAGE_SIZE = 100
MAX_PAGES = 50  # 50 × 100 = 5000 postings per tenant


class SmartRecruitersAdapter:
    source: AtsSource = AtsSource.SMARTRECRUITERS

    def detect(self, careers_url: str) -> str | None:
        host_and_path = urlparse(careers_url).netloc + urlparse(careers_url).path
        match = SLUG_PATTERN.search(host_and_path)
        return match.group("slug") if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        url = SR_API.format(slug=slug)
        results: list[dict[str, Any]] = []
        offset = 0
        total: int | None = None
        for _ in range(MAX_PAGES):
            resp = await client.get(
                url, params={"limit": PAGE_SIZE, "offset": offset}
            )
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            payload = cast(dict[str, Any], resp.json())
            content = payload.get("content", [])
            if not isinstance(content, list):
                break
            if total is None and isinstance(payload.get("totalFound"), int):
                total = payload["totalFound"]
            for row in content:
                if isinstance(row, dict):
                    row["_sr_slug"] = slug
                    results.append(row)
            if not content:
                break
            offset += len(content)
            if total is not None and offset >= total:
                break
        return results

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        title = str(raw.get("name", "")).strip()
        slug = raw.get("_sr_slug") or ""
        job_id = raw.get("id") or ""
        url = ""
        if slug and job_id:
            url = JOB_URL.format(slug=slug, job_id=job_id)
        loc = raw.get("location") or {}
        location: str | None = None
        is_remote = False
        if isinstance(loc, dict):
            parts = [
                str(loc.get("city") or "").strip(),
                str(loc.get("region") or "").strip(),
                str(loc.get("country") or "").strip().upper(),
            ]
            location = ", ".join(p for p in parts if p) or None
            is_remote = bool(loc.get("remote"))
        employment_type = None
        emp = raw.get("typeOfEmployment")
        if isinstance(emp, dict):
            employment_type = emp.get("label") or emp.get("id")
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": title,
            "location": location,
            "is_remote": is_remote,
            "employment_type": employment_type,
            "url": url,
            "posted_date": _parse_iso_date(raw.get("releasedDate")),
            "ats_source": self.source.value,
            "raw_payload": raw,
        }


def _parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
