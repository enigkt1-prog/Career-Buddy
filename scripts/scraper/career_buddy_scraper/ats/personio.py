"""Personio public job-board adapter (DACH-dominant HRIS).

Endpoint:  https://<slug>.jobs.personio.de/xml
           https://<slug>.jobs.personio.com/xml
Detection: ``<slug>.jobs.personio.de|com`` patterns in careers URLs.
Auth:      none.

Response is XML with ``<workzag-jobs>`` root containing ``<position>`` elements.
The adapter parses XML manually (no external xml dependency beyond stdlib)
and converts each position to a ``CanonicalJob``-shape dict.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree

from ..http import RateLimitedClient
from ..models import AtsSource

PERSONIO_API_DE = "https://{slug}.jobs.personio.de/xml"
PERSONIO_API_COM = "https://{slug}.jobs.personio.com/xml"
SLUG_PATTERN = re.compile(r"(?P<slug>[a-z0-9-]+)\.jobs\.personio\.(de|com)", re.I)


class PersonioAdapter:
    source: AtsSource = AtsSource.PERSONIO

    def detect(self, careers_url: str) -> str | None:
        host = urlparse(careers_url).netloc
        match = SLUG_PATTERN.search(host)
        return match.group("slug").lower() if match else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        for url_template in (PERSONIO_API_DE, PERSONIO_API_COM):
            url = url_template.format(slug=slug)
            try:
                resp = await client.get(url)
            except Exception:
                continue
            if resp.status_code != 200:
                continue
            try:
                root = ElementTree.fromstring(resp.text)
            except ElementTree.ParseError:
                continue
            positions: list[dict[str, Any]] = []
            for position in root.findall("position"):
                positions.append(_position_to_dict(position))
            if positions:
                return positions
        return []

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        return {
            "company_name": company_name,
            "company_domain": company_domain,
            "role_title": str(raw.get("name", "")).strip(),
            "location": raw.get("office") or None,
            "employment_type": raw.get("employmentType") or None,
            "url": str(raw.get("url", "")),
            "description": raw.get("jobDescriptions") or None,
            "posted_date": _parse_iso_date(raw.get("createdAt")),
            "ats_source": self.source.value,
            "raw_payload": raw,
        }


def _position_to_dict(elem: ElementTree.Element) -> dict[str, Any]:
    """Flatten a Personio ``<position>`` XML element to a dict."""
    out: dict[str, Any] = {}
    for child in elem:
        if child.tag == "jobDescriptions":
            descs: list[str] = []
            for jd in child.findall("jobDescription"):
                value = jd.findtext("value", "") or ""
                descs.append(value.strip())
            out["jobDescriptions"] = "\n\n".join(d for d in descs if d) or None
        else:
            out[child.tag] = (child.text or "").strip() or None
    return out


def _parse_iso_date(value: Any) -> date | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
