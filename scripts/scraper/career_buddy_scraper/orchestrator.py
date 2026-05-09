"""Per-VC orchestrator: detect → fetch → normalize → validate → upsert.

Workplan v6 Step 2d. Per-row try/except wraps **both** ``adapter.normalize()``
and ``CanonicalJob.model_validate()`` so neither aborts the batch.

Touched-set semantics: a ``(company_domain, ats_source)`` pair joins the
``touched`` set if and only if the fetch returned without raising AND the
result list was non-empty AND the per-batch invalid-rate ≤ 50 %. Provider
errors / empty results / high-invalid batches are excluded — no
stale-marking for them.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from rich.console import Console

from .ats.ashby import AshbyAdapter
from .ats.gemini_fallback import (
    GeminiFallbackBudget,
    try_gemini_extract,
)
from .ats.gemini_fallback import (
    is_enabled as gemini_fallback_enabled,
)
from .ats.greenhouse import GreenhouseAdapter
from .ats.lever import LeverAdapter
from .ats.personio import PersonioAdapter
from .ats.recruitee import RecruiteeAdapter
from .ats.workable import WorkableAdapter
from .db import REPO_ROOT, connect
from .discovery import discover_ats
from .http import RateLimitedClient
from .jobs_repo import mark_stale, upsert_jobs
from .models import AtsSource, CanonicalJob

console = Console()

ADAPTERS: dict[str, Any] = {
    "greenhouse": GreenhouseAdapter(),
    "lever": LeverAdapter(),
    "ashby": AshbyAdapter(),
    "workable": WorkableAdapter(),
    "personio": PersonioAdapter(),
    "recruitee": RecruiteeAdapter(),
}


@dataclass
class ProviderError:
    company_domain: str
    careers_url: str | None
    provider: str | None
    slug: str | None
    reason: str


@dataclass
class RunStats:
    started_at: float
    finished_at: float = 0.0
    vcs_total: int = 0
    vcs_matched: int = 0
    vcs_unmatched: int = 0
    rows_fetched: int = 0
    rows_valid: int = 0
    rows_invalid: int = 0
    inserted: int = 0
    updated: int = 0
    affected_stale: int = 0
    touched: list[list[str]] = field(default_factory=list)
    errors: list[ProviderError] = field(default_factory=list)
    by_provider: dict[str, dict[str, int]] = field(default_factory=dict)
    gemini_fallback_attempted: int = 0
    gemini_fallback_succeeded: int = 0
    gemini_fallback_jobs: int = 0
    gemini_fallback_skipped: int = 0


def _load_vcs_with_careers_url() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select domain, name, careers_url
            from vcs
            where careers_url is not null and careers_url <> ''
            order by domain;
            """
        )
        rows = cur.fetchall()
    return [{"domain": d, "name": n, "careers_url": c} for d, n, c in rows]


def _detect_direct(careers_url: str) -> tuple[str, str] | None:
    for provider_name, adapter in ADAPTERS.items():
        slug = adapter.detect(careers_url)
        if slug:
            return provider_name, slug
    return None


async def _resolve_provider(careers_url: str, client: RateLimitedClient) -> tuple[str, str] | None:
    direct = _detect_direct(careers_url)
    if direct:
        return direct
    return await discover_ats(careers_url, client)


def _bump_provider(stats: RunStats, provider: str, key: str, delta: int = 1) -> None:
    bucket = stats.by_provider.setdefault(
        provider,
        {"fetched": 0, "valid": 0, "invalid": 0, "errors": 0, "vcs": 0},
    )
    bucket[key] = bucket.get(key, 0) + delta


async def run_scrape(
    artifacts_dir: Path | None = None,
) -> RunStats:
    """Execute one full scrape pass over all ``vcs`` rows with a careers_url."""
    artifacts_dir = artifacts_dir or (REPO_ROOT / "artifacts")
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    stats = RunStats(started_at=time.time())

    vcs = _load_vcs_with_careers_url()
    stats.vcs_total = len(vcs)
    console.print(f"[bold]scrape start[/bold]: {len(vcs)} VCs with careers_url")

    quarantine: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    touched: set[tuple[str, str]] = set()
    all_records: list[CanonicalJob] = []

    use_gemini_fallback = gemini_fallback_enabled()
    gemini_budget = GeminiFallbackBudget()
    if use_gemini_fallback:
        console.print(
            f"[cyan]gemini fallback enabled (cap={gemini_budget.cap} VCs/run)[/cyan]"
        )

    async with RateLimitedClient(
        cache_dir=artifacts_dir / "cache",
    ) as client:
        for vc in vcs:
            domain = str(vc["domain"]).lower()
            careers_url = str(vc["careers_url"])
            name = str(vc["name"])
            resolved = await _resolve_provider(careers_url, client)
            if resolved is None:
                if use_gemini_fallback:
                    stats.gemini_fallback_attempted += 1
                    jobs, err = await try_gemini_extract(
                        careers_url=careers_url,
                        company_name=name,
                        company_domain=domain,
                        client=client,
                        budget=gemini_budget,
                    )
                    if err is None and jobs:
                        stats.gemini_fallback_succeeded += 1
                        stats.gemini_fallback_jobs += len(jobs)
                        stats.vcs_matched += 1
                        _bump_provider(stats, "gemini", "vcs")
                        _bump_provider(stats, "gemini", "fetched", len(jobs))
                        _bump_provider(stats, "gemini", "valid", len(jobs))
                        all_records.extend(jobs)
                        touched.add((domain, AtsSource.CUSTOM.value))
                        console.print(
                            f"[green]≈ {name:<30} gemini-fallback ok ({len(jobs)} jobs)[/green]"
                        )
                        continue
                    stats.gemini_fallback_skipped += 1
                    if err:
                        console.print(
                            f"[yellow]≈ {name:<30} gemini-fallback skipped: {err}[/yellow]"
                        )
                stats.vcs_unmatched += 1
                unmatched.append({"domain": domain, "name": name, "careers_url": careers_url})
                console.print(f"[dim]✗ {name:<30} unmatched[/dim]")
                continue
            provider_name, slug = resolved
            stats.vcs_matched += 1
            _bump_provider(stats, provider_name, "vcs")
            adapter = ADAPTERS[provider_name]
            try:
                rows = await adapter.fetch(slug, client)
            except Exception as e:
                _bump_provider(stats, provider_name, "errors")
                stats.errors.append(
                    ProviderError(
                        company_domain=domain,
                        careers_url=careers_url,
                        provider=provider_name,
                        slug=slug,
                        reason=f"fetch raised: {type(e).__name__}: {e}",
                    )
                )
                console.print(f"[red]✗ {name:<30} fetch error: {e}[/red]")
                continue
            n_fetched = len(rows)
            _bump_provider(stats, provider_name, "fetched", n_fetched)
            stats.rows_fetched += n_fetched
            valid_in_batch: list[CanonicalJob] = []
            invalid_in_batch = 0
            for raw in rows:
                try:
                    normalised = adapter.normalize(raw, name, domain)
                except Exception as e:
                    invalid_in_batch += 1
                    quarantine.append(
                        {
                            "stage": "normalize",
                            "provider": provider_name,
                            "slug": slug,
                            "company_domain": domain,
                            "error": f"{type(e).__name__}: {e}",
                            "raw": raw,
                        }
                    )
                    continue
                try:
                    record = CanonicalJob.model_validate(normalised)
                except ValidationError as e:
                    invalid_in_batch += 1
                    quarantine.append(
                        {
                            "stage": "validate",
                            "provider": provider_name,
                            "slug": slug,
                            "company_domain": domain,
                            "error": str(e),
                            "normalised": normalised,
                        }
                    )
                    continue
                valid_in_batch.append(record)
            n_valid = len(valid_in_batch)
            stats.rows_valid += n_valid
            stats.rows_invalid += invalid_in_batch
            _bump_provider(stats, provider_name, "valid", n_valid)
            _bump_provider(stats, provider_name, "invalid", invalid_in_batch)
            invalid_rate = invalid_in_batch / max(n_fetched, 1)
            console.print(
                f"  {name:<30} → {provider_name:<10} {slug:<25}"
                f" | fetched={n_fetched} valid={n_valid} invalid={invalid_in_batch}"
            )
            if n_fetched == 0:
                continue  # excluded from touched (empty result)
            if invalid_rate > 0.5:
                console.print(
                    f"[yellow]  excluded from touched: invalid-rate {invalid_rate:.0%}[/yellow]"
                )
                continue
            touched.add((domain, AtsSource(provider_name).value))
            all_records.extend(valid_in_batch)

        metrics = client.metrics()

    if all_records:
        inserted, updated = upsert_jobs(all_records)
        stats.inserted = inserted
        stats.updated = updated

    if touched:
        affected = mark_stale(touched)
        stats.affected_stale = len(affected)
        if not affected.issubset(touched):
            console.print(
                "[red]mark_stale returned pairs outside touched set — abort & investigate[/red]"
            )
            stats.errors.append(
                ProviderError(
                    company_domain="",
                    careers_url=None,
                    provider=None,
                    slug=None,
                    reason="mark_stale leaked outside touched",
                )
            )

    stats.touched = sorted([list(p) for p in touched])
    stats.finished_at = time.time()

    # Write artifacts
    if quarantine:
        (artifacts_dir / f"invalid_jobs_{timestamp}.json").write_text(
            json.dumps(quarantine, indent=2, default=str), encoding="utf-8"
        )
    if unmatched:
        (artifacts_dir / f"unmatched_vcs_{timestamp}.json").write_text(
            json.dumps(unmatched, indent=2), encoding="utf-8"
        )
    run_stats_payload = {
        "timestamp_utc": timestamp,
        "stats": {
            "started_at": stats.started_at,
            "finished_at": stats.finished_at,
            "duration_s": stats.finished_at - stats.started_at,
            "vcs_total": stats.vcs_total,
            "vcs_matched": stats.vcs_matched,
            "vcs_unmatched": stats.vcs_unmatched,
            "rows_fetched": stats.rows_fetched,
            "rows_valid": stats.rows_valid,
            "rows_invalid": stats.rows_invalid,
            "inserted": stats.inserted,
            "updated": stats.updated,
            "affected_stale": stats.affected_stale,
            "touched": stats.touched,
            "by_provider": stats.by_provider,
            "gemini_fallback": {
                "attempted": stats.gemini_fallback_attempted,
                "succeeded": stats.gemini_fallback_succeeded,
                "skipped": stats.gemini_fallback_skipped,
                "jobs": stats.gemini_fallback_jobs,
            },
        },
        "errors": [
            {
                "company_domain": e.company_domain,
                "careers_url": e.careers_url,
                "provider": e.provider,
                "slug": e.slug,
                "reason": e.reason,
            }
            for e in stats.errors
        ],
        "limiter_metrics": {
            "total_requests": metrics["total_requests"],
            "cache_hits": metrics["cache_hits"],
            "peak_per_minute": metrics["peak_per_minute"],
            "by_method": metrics["by_method"],
            "by_status": metrics["by_status"],
        },
    }
    (artifacts_dir / f"run-stats-{timestamp}.json").write_text(
        json.dumps(run_stats_payload, indent=2, default=str), encoding="utf-8"
    )

    console.print()
    console.print(
        f"[bold]scrape done[/bold]: matched {stats.vcs_matched}/{stats.vcs_total} VCs, "
        f"fetched {stats.rows_fetched}, valid {stats.rows_valid}, "
        f"invalid {stats.rows_invalid}, "
        f"inserted {stats.inserted}, updated {stats.updated}, "
        f"stale {stats.affected_stale}, peak/min {metrics['peak_per_minute']}"
    )
    return stats
