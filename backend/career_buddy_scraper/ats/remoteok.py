"""RemoteOK public aggregator adapter.

Endpoint:  GET https://remoteok.com/api
Detection: ``remoteok.com`` URLs.
Auth:      none (requires a real User-Agent — already supplied by
           ``RateLimitedClient``).

Unlike VC-portfolio adapters, RemoteOK is a JOB AGGREGATOR — every
posting comes from a different hiring company. The normalize step
therefore IGNORES the per-VC ``company_name``/``company_domain`` we
seed and pulls the real hiring company out of each posting's
``company`` field. ``company_domain`` is derived from the posting's
``apply_url`` when it points at a non-aggregator host, otherwise it
falls back to a sanitised version of the company name suffixed with
``.remoteok-aggregator`` so the row stays unique without polluting
a real-company domain.

The first element of the API response is a license/legal stub, not
a posting — the adapter drops the first row.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, cast
from urllib.parse import urlparse

from ..http import RateLimitedClient
from ..models import AtsSource

REMOTEOK_API = "https://remoteok.com/api"
DETECT_HOST = re.compile(r"remoteok\.com", re.I)
AGGREGATOR_HOSTS = {
    "remoteok.com",
    "remoteok.io",
    "weworkremotely.com",
    "wellfound.com",
    "angel.co",
}


class RemoteOkAdapter:
    source: AtsSource = AtsSource.REMOTEOK

    def detect(self, careers_url: str) -> str | None:
        host = urlparse(careers_url).netloc
        return "remoteok" if DETECT_HOST.search(host) else None

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        # `slug` is unused — single global endpoint. Kept for the
        # AtsAdapter Protocol signature.
        del slug
        try:
            resp = await client.get(REMOTEOK_API)
        except Exception:
            return []
        if resp.status_code != 200:
            return []
        payload = resp.json()
        if not isinstance(payload, list):
            return []
        # First element is a legal/metadata stub keyed by ``legal``.
        return [row for row in payload if isinstance(row, dict) and "legal" not in row]

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        del company_name, company_domain  # aggregator — pull from raw
        title = str(raw.get("position") or "").strip()
        company = str(raw.get("company") or "").strip() or "Unknown"
        url = str(raw.get("url") or raw.get("apply_url") or "")
        domain = _derive_domain(raw.get("apply_url"), company)
        location = str(raw.get("location") or "").strip() or None
        posted_date = _parse_epoch(raw.get("epoch")) or _parse_iso_date(raw.get("date"))
        return {
            "company_name": company,
            "company_domain": domain,
            "role_title": title,
            "location": location,
            "is_remote": True,  # RemoteOK is remote-only by definition
            "employment_type": None,
            "url": url,
            "posted_date": posted_date,
            "ats_source": self.source.value,
            "raw_payload": raw,
        }


def _derive_domain(apply_url: Any, company: str) -> str:
    """Best-effort hiring-company domain.

    Prefer the host of ``apply_url`` if it points at the company's own
    ATS (greenhouse / lever / ashby) or a custom domain; otherwise
    fall back to ``<sanitised-name>.remoteok-aggregator`` so the row
    stays distinct without claiming a real domain.
    """
    if isinstance(apply_url, str) and apply_url:
        host = urlparse(apply_url).hostname or ""
        host = host.lower()
        if host and not any(host.endswith(h) for h in AGGREGATOR_HOSTS):
            # If the apply_url is a greenhouse/lever board, the host
            # is ``boards.greenhouse.io`` etc — keep the company-
            # specific subdomain or slug if we can detect it.
            return host
    sanitised = re.sub(r"[^a-z0-9-]+", "-", company.lower()).strip("-")
    return f"{sanitised or 'unknown'}.remoteok-aggregator"


def _parse_epoch(value: Any) -> date | None:
    if value is None:
        return None
    try:
        return datetime.utcfromtimestamp(int(value)).date()
    except (TypeError, ValueError, OSError):
        return None


def _parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
