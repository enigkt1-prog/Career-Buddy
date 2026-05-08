"""Adapter protocol shared by every ATS implementation.

Adapters return raw dicts; the orchestrator owns Pydantic validation so
``ValidationError``s can be quarantined per-row without aborting the run
(workplan v6 Step 2c, Codex 3 finding 1 + Codex 5 patch).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from ..http import RateLimitedClient
from ..models import AtsSource


@runtime_checkable
class AtsAdapter(Protocol):
    """Detect / fetch / normalize contract for a single ATS provider."""

    source: AtsSource

    def detect(self, careers_url: str) -> str | None:
        """Return the ATS slug if ``careers_url`` belongs to this provider, else None."""

    async def fetch(self, slug: str, client: RateLimitedClient) -> list[dict[str, Any]]:
        """Pull all open postings for ``slug`` from the provider's public API."""

    def normalize(
        self,
        raw: dict[str, Any],
        company_name: str,
        company_domain: str,
    ) -> dict[str, Any]:
        """Map one raw posting to a ``CanonicalJob``-shape dict.

        Returns a plain dict so the orchestrator can wrap
        ``CanonicalJob.model_validate(...)`` in a per-row try/except.
        Keys must include ``company_name``, ``company_domain``,
        ``role_title``, ``url``, ``ats_source``. Other fields may be None.
        """


USER_AGENT = "Career-Buddy-Bot/1.0 (+https://career-buddy.app/bot)"
DEFAULT_TIMEOUT_S = 15.0
DEFAULT_PER_HOST_DELAY_S = 0.2
DEFAULT_PER_PROVIDER_CONCURRENCY = 5
