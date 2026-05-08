"""HTML-discovery hop: find embedded ATS slugs on a careers page.

When :meth:`AtsAdapter.detect` returns None for a VC's ``careers_url``
(because the URL is the firm's own page, not a direct ATS URL), this
module fetches the page HTML and regex-scans for any of the four
supported ATS URL shapes. First match wins.
"""

from __future__ import annotations

import re

from .http import RateLimitedClient

# Detection patterns, in priority order (Greenhouse first because it is the
# most common embed; Lever second; Ashby and Workable last).
ATS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("greenhouse", re.compile(r"boards\.greenhouse\.io/(?P<slug>[a-z0-9-]+)", re.I)),
    ("greenhouse", re.compile(r"(?P<slug>[a-z0-9-]+)\.greenhouse\.io", re.I)),
    ("lever", re.compile(r"jobs\.lever\.co/(?P<slug>[a-z0-9-]+)", re.I)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/(?P<slug>[a-z0-9-]+)", re.I)),
    ("workable", re.compile(r"apply\.workable\.com/(?P<slug>[a-z0-9-]+)", re.I)),
]


async def discover_ats(careers_url: str, client: RateLimitedClient) -> tuple[str, str] | None:
    """Fetch ``careers_url`` and return ``(provider, slug)`` of first match, or None.

    Returns the *first* pattern hit. Network or 4xx/5xx errors return None
    (caller logs as ``unmatched``).
    """
    try:
        resp = await client.get(careers_url, follow_redirects=True)
    except Exception:
        return None
    if resp.status_code >= 400:
        return None
    text = resp.text
    for provider, pattern in ATS_PATTERNS:
        match = pattern.search(text)
        if match:
            return provider, match.group("slug").lower()
    return None
