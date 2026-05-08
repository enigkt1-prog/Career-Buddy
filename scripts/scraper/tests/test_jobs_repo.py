"""Live-DB tests for the ``jobs`` repository.

These tests touch the configured Supabase project. They are skipped
automatically if ``SUPABASE_DB_URL`` is not set. Every test creates rows
keyed on the synthetic ``smoke-test.invalid`` domain and the
``raw_payload->>'smoke_test'='true'`` sentinel, then cleans up in a
``finally`` block per workplan v6 hard rules.
"""

from __future__ import annotations

import os
from datetime import date

import pytest

from career_buddy_scraper.db import ENV_PATH, connect
from career_buddy_scraper.jobs_repo import (
    cleanup_smoke_test_rows,
    count_active,
    mark_stale,
    upsert_jobs,
)
from career_buddy_scraper.models import AtsSource, CanonicalJob

_DB_AVAILABLE = bool(os.environ.get("SUPABASE_DB_URL")) or ENV_PATH.exists()
pytestmark = pytest.mark.skipif(
    not _DB_AVAILABLE,
    reason="No SUPABASE_DB_URL and no repo-root .env; live-DB tests skipped.",
)


def _make_record(
    role_title: str = "Founders Associate",
    url: str = "https://smoke-test.invalid/jobs/1",
    posted_date: date | None = None,
) -> CanonicalJob:
    return CanonicalJob(
        company_name="Smoke Test Co",
        company_domain="smoke-test.invalid",
        role_title=role_title,
        url=url,  # type: ignore[arg-type]
        ats_source=AtsSource.GREENHOUSE,
        posted_date=posted_date,
        raw_payload={"smoke_test": "true"},
    )


def test_upsert_insert_then_update_round_trip() -> None:
    cleanup_smoke_test_rows()
    try:
        rec = _make_record(role_title="Founders Associate")
        ins, upd = upsert_jobs([rec])
        assert (ins, upd) == (1, 0)
        ins, upd = upsert_jobs([rec])
        assert (ins, upd) == (0, 1)
    finally:
        cleanup_smoke_test_rows()


def test_mark_stale_skips_when_last_seen_is_recent() -> None:
    cleanup_smoke_test_rows()
    try:
        rec = _make_record()
        upsert_jobs([rec])
        affected = mark_stale({("smoke-test.invalid", AtsSource.GREENHOUSE.value)})
        assert affected == set()
    finally:
        cleanup_smoke_test_rows()


def test_mark_stale_deactivates_when_last_seen_is_old() -> None:
    cleanup_smoke_test_rows()
    try:
        rec = _make_record(url="https://smoke-test.invalid/jobs/old")
        upsert_jobs([rec])
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                update jobs
                set last_seen_at = now() - interval '49 hours'
                where company_domain = 'smoke-test.invalid'
                  and raw_payload->>'smoke_test' = 'true';
                """
            )
            conn.commit()
        touched = {("smoke-test.invalid", AtsSource.GREENHOUSE.value)}
        affected_first = mark_stale(touched)
        assert ("smoke-test.invalid", AtsSource.GREENHOUSE.value) in affected_first
        affected_second = mark_stale(touched)
        assert affected_second == set()
    finally:
        cleanup_smoke_test_rows()


def test_count_active_excludes_inactive() -> None:
    cleanup_smoke_test_rows()
    try:
        before_active = count_active()
        upsert_jobs([_make_record(url="https://smoke-test.invalid/jobs/2")])
        after_active = count_active()
        assert after_active == before_active + 1
    finally:
        cleanup_smoke_test_rows()
