"""WeWorkRemotely public aggregator adapter (RSS).

Endpoint:  GET https://weworkremotely.com/remote-jobs.rss
Detection: ``weworkremotely.com`` URLs.
Auth:      none.

RSS feed; each ``<item>`` is one posting. Title is shaped
``Company Name: Job Title`` — we split on the first colon. Caps at
~100 items per fetch (server-side). Posted date comes from
``<pubDate>``.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree

from ..http import RateLimitedClient
from ..models import AtsSource

WWR_RSS = "https://weworkremotely.com/remote-jobs.rss"
DETECT_HOST = re.compile(r"weworkremotely\.com", re.I)


class WeWorkRemotelyAdapter:
    source: AtsSource = AtsSource.WEWORKREMOTELY

    def detect(self, careers_url: str) -> str | None:
        host = urlparse(careers_url).netloc
        return "weworkremotely" if DETECT_HOST.search(host) else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        del slug  # single global feed
        try:
            resp = await client.get(WWR_RSS)
        except Exception:
            return []
        if resp.status_code != 200:
            return []
        try:
            root = ElementTree.fromstring(resp.text)
        except ElementTree.ParseError:
            return []
        items: list[dict[str, Any]] = []
        for item in root.iter("item"):
            row: dict[str, Any] = {}
            for child in item:
                tag = child.tag.split("}")[-1]  # strip namespace
                row[tag] = (child.text or "").strip() or None
            items.append(row)
        return items

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        del company_name, company_domain  # aggregator
        title = raw.get("title") or ""
        company, role_title = _split_title(title)
        url = raw.get("link") or ""
        location = raw.get("region") or "Remote"
        return {
            "company_name": company,
            "company_domain": _name_to_domain(company),
            "role_title": role_title,
            "location": location,
            "is_remote": True,
            "employment_type": None,
            "url": url,
            "posted_date": _parse_rfc2822(raw.get("pubDate")),
            "ats_source": self.source.value,
            "raw_payload": raw,
        }


def _split_title(title: str) -> tuple[str, str]:
    """``"ACME Inc: Senior Engineer"`` → ``("ACME Inc", "Senior Engineer")``."""
    if not title:
        return "Unknown", ""
    if ":" in title:
        company, _, role = title.partition(":")
        return company.strip() or "Unknown", role.strip()
    return "Unknown", title.strip()


def _name_to_domain(company: str) -> str:
    sanitised = re.sub(r"[^a-z0-9-]+", "-", company.lower()).strip("-")
    return f"{sanitised or 'unknown'}.wwr-aggregator"


def _parse_rfc2822(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return parsedate_to_datetime(value).date()
    except (TypeError, ValueError):
        return None
