"""Probe an accelerator's portfolio companies for supported ATS embeds.

Reads a JSON list of ``{name, domain, slug?}`` rows (slug defaults to
the lower-cased company name with non-alphanums stripped), then for
each row attempts a direct ATS API fetch against the slug across all
supported providers:

  greenhouse, lever, ashby, workable, personio, recruitee, workday

The first provider that returns a non-empty job list wins. Writes
the producers as a Career-Buddy seed JSON ready for
``cli.seed_notion`` to upsert.

Designed for the Gap 3 accelerator-pipeline expansion: hand it the
list of companies a given accelerator has invested in, get back the
subset that produces jobs on our supported ATS infrastructure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any

from rich.console import Console

from ..ats.ashby import AshbyAdapter
from ..ats.greenhouse import GreenhouseAdapter
from ..ats.lever import LeverAdapter
from ..ats.personio import PersonioAdapter
from ..ats.recruitee import RecruiteeAdapter
from ..ats.workable import WorkableAdapter
from ..http import RateLimitedClient

console = Console()


SUPPORTED = {
    "greenhouse": (
        GreenhouseAdapter(),
        "https://boards.greenhouse.io/{slug}",
    ),
    "ashby": (
        AshbyAdapter(),
        "https://jobs.ashbyhq.com/{slug}",
    ),
    "lever": (
        LeverAdapter(),
        "https://jobs.lever.co/{slug}",
    ),
    "workable": (
        WorkableAdapter(),
        "https://apply.workable.com/{slug}",
    ),
    "personio": (
        PersonioAdapter(),
        "https://{slug}.jobs.personio.de",
    ),
    "recruitee": (
        RecruiteeAdapter(),
        "https://{slug}.recruitee.com",
    ),
}


def _slugify(name: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "", name.lower())
    return out


def _domain_from_website(website: str | None) -> str | None:
    if not website:
        return None
    w = website.strip().lower()
    w = re.sub(r"^https?://", "", w)
    w = w.split("/")[0]
    w = re.sub(r"^www\.", "", w)
    if not w or "." not in w:
        return None
    return w


async def _probe_company(
    sem: asyncio.Semaphore,
    client: RateLimitedClient,
    name: str,
    domain: str,
    slug_hint: str | None,
) -> dict[str, Any] | None:
    """Try each supported ATS in priority order; return the first hit."""
    slugs = []
    if slug_hint:
        slugs.append(slug_hint)
    slugs.append(_slugify(name))
    # Domain-derived slug: strip the TLD.
    dom_slug = domain.split(".")[0] if domain else ""
    if dom_slug and dom_slug not in slugs:
        slugs.append(dom_slug)

    async with sem:
        for ats_name, (adapter, url_tpl) in SUPPORTED.items():
            for slug in slugs:
                if not slug:
                    continue
                try:
                    rows = await adapter.fetch(slug, client)
                except Exception:
                    rows = []
                if rows:
                    return {
                        "name": name,
                        "domain": domain,
                        "careers_url": url_tpl.format(slug=slug),
                        "ats": ats_name,
                        "slug": slug,
                        "job_count": len(rows),
                    }
    return None


async def probe(
    companies: list[dict[str, str]],
    concurrency: int = 6,
) -> list[dict[str, Any]]:
    sem = asyncio.Semaphore(concurrency)
    found: list[dict[str, Any]] = []
    async with RateLimitedClient() as client:
        tasks = [
            _probe_company(
                sem,
                client,
                c["name"],
                c.get("domain", ""),
                c.get("slug"),
            )
            for c in companies
        ]
        for index, fut in enumerate(asyncio.as_completed(tasks), 1):
            res = await fut
            if res:
                found.append(res)
                console.print(
                    f"[green]hit[/green] {len(found):4d}/{index}  "
                    f"{res['name']:30s} {res['ats']}/{res['slug']} {res['job_count']:4d}"
                )
            elif index % 50 == 0:
                console.print(f"  ...probed {index}/{len(companies)}, hits {len(found)}")
    return found


def _load_yc_oss(path: Path, only_hiring: bool = True) -> list[dict[str, str]]:
    """Load the YC OSS API JSON dump filtered to active + hiring."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        if row.get("status") and row.get("status") != "Active":
            continue
        if only_hiring and not row.get("isHiring"):
            continue
        domain = _domain_from_website(row.get("website"))
        if not domain:
            continue
        out.append(
            {
                "name": row.get("name") or domain,
                "domain": domain,
                "slug": row.get("slug") or "",
            }
        )
    return out


def _load_simple(path: Path) -> list[dict[str, str]]:
    """Load a {name, domain, slug?} JSON list."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        domain = row.get("domain")
        name = row.get("name")
        if not domain or not name:
            continue
        out.append({"name": name, "domain": domain, "slug": row.get("slug", "")})
    return out


def _to_seed(
    producers: list[dict[str, Any]],
    accelerator: str,
    geography: str | None = None,
) -> list[dict[str, Any]]:
    return [
        {
            "name": p["name"],
            "domain": p["domain"],
            "careers_url": p["careers_url"],
            "geography": geography,
            "stage_focus": "seed",
            "sector_tags": [accelerator.lower()],
            "tier": 2,
            "sources": [f"session-d-gap3-{accelerator.lower()}"],
            "notes": (
                f"{accelerator} portfolio; {p['ats']}/{p['slug']} verified "
                f"{p['job_count']} jobs (probe 2026-05-11)"
            ),
        }
        for p in producers
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe accelerator portfolio")
    parser.add_argument(
        "--yc-oss",
        type=Path,
        help="Path to a YC OSS API dump (filters active + isHiring).",
    )
    parser.add_argument(
        "--companies",
        type=Path,
        help="Path to a simple JSON list of {name, domain, slug?}.",
    )
    parser.add_argument(
        "--accelerator",
        type=str,
        required=True,
        help="Accelerator label (e.g. 'yc', 'antler', 'speedrun').",
    )
    parser.add_argument("--geography", type=str, default=None)
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Seed JSON output (consumable by cli.seed_notion).",
    )
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Probe only the first N companies (sanity check).",
    )
    args = parser.parse_args()

    if args.yc_oss:
        companies = _load_yc_oss(args.yc_oss)
    elif args.companies:
        companies = _load_simple(args.companies)
    else:
        raise SystemExit("provide --yc-oss or --companies")

    if args.limit:
        companies = companies[: args.limit]

    console.print(f"Probing {len(companies)} {args.accelerator} companies...")
    producers = asyncio.run(probe(companies, concurrency=args.concurrency))

    seed_rows = _to_seed(producers, args.accelerator, args.geography)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(seed_rows, indent=2), encoding="utf-8")
    console.print(
        f"\n[bold green]done[/bold green]: {len(producers)} producers "
        f"({sum(p['job_count'] for p in producers)} jobs)"
        f"\nseed written to {args.out}"
    )


if __name__ == "__main__":
    main()
