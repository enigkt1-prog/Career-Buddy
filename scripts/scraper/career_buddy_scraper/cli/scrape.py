"""Run the orchestrator end-to-end against the live Career-Buddy Supabase project.

Usage::

    uv run python -m career_buddy_scraper.cli.scrape
"""

from __future__ import annotations

import asyncio
import sys

from ..jobs_repo import count_active
from ..orchestrator import run_scrape


async def _main() -> int:
    before = count_active()
    print(f"jobs.is_active before: {before}")
    stats = await run_scrape()
    after = count_active()
    print(f"jobs.is_active after : {after} (delta={after - before})")
    if stats.inserted + stats.updated == 0:
        print("warning: 0 jobs written — investigate run-stats artifact")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
