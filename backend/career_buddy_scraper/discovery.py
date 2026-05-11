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
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v\d+/boards/(?P<slug>[a-z0-9-]+)", re.I)),
    ("greenhouse", re.compile(r"(?<![\w-])(?!boards-api|boards|api|app|www|jobs|talent|careers)(?P<slug>[a-z0-9-]+)\.greenhouse\.io", re.I)),
    ("lever", re.compile(r"jobs\.lever\.co/(?P<slug>[a-z0-9-]+)", re.I)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/(?P<slug>[a-z0-9-]+)", re.I)),
    ("workable", re.compile(r"apply\.workable\.com/(?P<slug>[a-z0-9-]+)", re.I)),
    ("personio", re.compile(r"(?P<slug>[a-z0-9-]+)\.jobs\.personio\.(?:de|com)", re.I)),
    ("recruitee", re.compile(r"(?P<slug>[a-z0-9-]+)\.recruitee\.com", re.I)),
    # Workday slug is compound: <tenant>/<wd_num>/<site_id>. The discovery
    # regex captures all three as one slug string so the orchestrator can
    # route it back through `WorkdayAdapter`.
    (
        "workday",
        re.compile(
            r"(?P<slug>[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?[A-Za-z0-9_-]+)",
            re.I,
        ),
    ),
    (
        "smartrecruiters",
        re.compile(
            r"(?:careers|jobs)\.smartrecruiters\.com/(?P<slug>[A-Za-z0-9_-]+)",
        ),
    ),
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
            slug = match.group("slug")
            if provider == "workday":
                # Captured shape: ``tenant.wd<N>.myworkdayjobs.com[/<lang>]/<site_id>``.
                # Normalise to the adapter's expected ``tenant/wd_num/site_id``.
                normalised = _normalise_workday_slug(slug)
                if normalised is None:
                    continue
                return provider, normalised
            if provider == "smartrecruiters":
                # SmartRecruiters company identifiers are case-sensitive
                # (e.g. "scalablegmbh" vs "ScalableCapital"). Keep raw casing.
                return provider, slug
            return provider, slug.lower()
    return None


_WORKDAY_PARTS = re.compile(
    r"(?P<tenant>[a-z0-9-]+)\.(?P<wd_num>wd\d+)\.myworkdayjobs\.com"
    r"(?:/[a-z]{2}-[A-Z]{2})?"
    r"/(?P<site_id>[A-Za-z0-9_-]+)",
    re.I,
)


def _normalise_workday_slug(captured: str) -> str | None:
    m = _WORKDAY_PARTS.search(captured)
    if m is None:
        return None
    return f"{m.group('tenant').lower()}/{m.group('wd_num').lower()}/{m.group('site_id')}"
