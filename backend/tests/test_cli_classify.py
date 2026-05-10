"""Smoke tests for cli/classify.py.

Stubs out the ``connect`` context-manager so the CLI runs against
in-memory rows. Asserts dry-run produces no DB writes, --write produces
expected per-row UPDATE calls with provenance columns, audit CSV is
written under audit/, and aggregate counts are correct.
"""

from __future__ import annotations

import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Stub psycopg connect/cursor — minimal surface used by the CLI.
# ---------------------------------------------------------------------------


class _StubCursor:
    def __init__(self, fetched_rows: list[list[tuple[Any, ...]]]) -> None:
        self._queue = fetched_rows  # list of result-sets, popped per execute
        self._last_rowcount = 1
        self.executes: list[tuple[str, tuple[Any, ...] | None]] = []

    def execute(self, sql: str, params: Any | None = None) -> None:
        normalized_sql = sql.strip().lower()
        self.executes.append((normalized_sql, params))
        # Approximate rowcount semantics for race-safe UPDATE: assume the
        # row was still NULL so the update succeeds.
        self._last_rowcount = 1

    def fetchone(self) -> tuple[Any, ...] | None:
        if self._queue and self._queue[0]:
            return self._queue[0].pop(0)
        return None

    def fetchall(self) -> list[tuple[Any, ...]]:
        if not self._queue:
            return []
        return self._queue.pop(0)

    @property
    def rowcount(self) -> int:
        return self._last_rowcount

    def __enter__(self) -> _StubCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class _StubConnection:
    def __init__(self, cursor: _StubCursor) -> None:
        self._cur = cursor
        self.committed = False

    def cursor(self) -> _StubCursor:
        return self._cur

    def commit(self) -> None:
        self.committed = True

    def __enter__(self) -> _StubConnection:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def _make_connect_factory(rows: list[tuple[str, str]]) -> Any:
    """Returns a function suitable for patching cli.classify.connect.

    Each call to connect() returns a fresh _StubConnection; the cursor
    serves the queued result-sets in order:
      1. SELECT pending rows
      2. SELECT total active count
      3. SELECT already-classified count
      then per-row UPDATEs for each proposal (no fetch needed).
    The same queue is shared across connect() calls so successive
    execute() calls keep popping from the same head.
    """
    pending_rows = list(rows)  # copy
    total_active = (len(pending_rows) + 5,)
    already_classified = (5,)

    @contextmanager
    def _factory():
        cur = _StubCursor(
            fetched_rows=[
                pending_rows,
                [total_active],
                [already_classified],
            ]
        )
        yield _StubConnection(cur)

    return _factory


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_cli(
    argv: list[str],
    rows: list[tuple[str, str]],
    audit_dir: Path,
) -> int:
    from career_buddy_scraper.cli import classify as cli

    factory = _make_connect_factory(rows)
    with patch.object(cli, "connect", factory), patch.object(sys, "argv", ["classify", *argv, "--audit-dir", str(audit_dir)]):
        return cli.main()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_dry_run_creates_audit_csv_no_writes(tmp_path: Path) -> None:
    rows = [
        (str(uuid.uuid4()), "Senior Software Engineer"),     # tier15 → other
        (str(uuid.uuid4()), "Strategy Associate"),           # tier1 → strategy
        (str(uuid.uuid4()), "Pure noise that matches nothing 12345"),  # residual
    ]
    rc = _run_cli([], rows=rows, audit_dir=tmp_path)
    assert rc == 0
    audit_files = list(tmp_path.glob("classify-*.csv"))
    assert len(audit_files) == 1
    contents = audit_files[0].read_text()
    # Header + 2 audit rows (residual_none excluded).
    assert "id,title,proposed_category,source,written_at" in contents
    assert "Senior Software Engineer" in contents
    assert "Strategy Associate" in contents
    # Residual row is NOT written to audit.
    assert "Pure noise that matches nothing 12345" not in contents
    # written_at is empty in dry-run.
    for line in contents.strip().splitlines()[1:]:
        assert line.endswith(",")  # last column empty


def test_write_runs_per_row_update_with_provenance(tmp_path: Path) -> None:
    from career_buddy_scraper.cli import classify as cli

    rows = [
        (str(uuid.uuid4()), "Software Engineer"),     # tier15
        (str(uuid.uuid4()), "Founders Associate"),    # tier1
    ]
    captured_executes: list[tuple[str, tuple[Any, ...] | None]] = []

    @contextmanager
    def factory():
        cur = _StubCursor(
            fetched_rows=[
                list(rows),
                [(99,)],
                [(5,)],
            ]
        )
        original_execute = cur.execute

        def trap(sql: str, params: Any | None = None) -> None:
            original_execute(sql, params)
            captured_executes.append((sql.strip().lower(), params))

        cur.execute = trap  # type: ignore[method-assign]
        yield _StubConnection(cur)

    with patch.object(cli, "connect", factory), patch.object(sys, "argv", ["classify", "--write", "--audit-dir", str(tmp_path)]):
        rc = cli.main()

    assert rc == 0

    # Find UPDATE-jobs statements; assert provenance columns present.
    update_jobs = [
        (sql, params) for sql, params in captured_executes
        if sql.startswith("update jobs")
    ]
    assert len(update_jobs) == 2
    for sql, _params in update_jobs:
        assert "classified_at = now()" in sql
        assert "classified_source" in sql
        assert "where id = %s and role_category is null" in sql
    # Source values match expected sources.
    sources = {p[1] for _sql, p in update_jobs}
    assert sources == {"tier1", "tier15"}

    # classify_runs INSERT + UPDATE both present.
    sqls = [s for s, _ in captured_executes]
    assert any("insert into classify_runs" in s for s in sqls)
    assert any("update classify_runs" in s and "finished = true" in s for s in sqls)

    # Audit CSV has written_at populated for both written rows.
    audit_files = list(tmp_path.glob("classify-*.csv"))
    assert len(audit_files) == 1
    rows_text = audit_files[0].read_text().strip().splitlines()
    assert len(rows_text) == 3  # header + 2 rows
    for line in rows_text[1:]:
        # written_at is the last column and non-empty in --write mode.
        assert not line.endswith(",")


def test_dry_run_no_classify_runs_row_inserted(tmp_path: Path) -> None:
    from career_buddy_scraper.cli import classify as cli

    captured: list[str] = []

    @contextmanager
    def factory():
        cur = _StubCursor(
            fetched_rows=[
                [(str(uuid.uuid4()), "Software Engineer")],
                [(99,)],
                [(5,)],
            ]
        )
        original_execute = cur.execute

        def trap(sql: str, params: Any | None = None) -> None:
            original_execute(sql, params)
            captured.append(sql.strip().lower())

        cur.execute = trap  # type: ignore[method-assign]
        yield _StubConnection(cur)

    with patch.object(cli, "connect", factory), patch.object(sys, "argv", ["classify", "--audit-dir", str(tmp_path)]):
        rc = cli.main()

    assert rc == 0
    assert not any("insert into classify_runs" in s for s in captured)
    assert not any("update jobs" in s for s in captured)


def test_empty_pending_rows_short_circuits(tmp_path: Path) -> None:
    rc = _run_cli([], rows=[], audit_dir=tmp_path)
    assert rc == 0
    # No audit file created when nothing to classify.
    assert not list(tmp_path.glob("classify-*.csv"))


@pytest.mark.parametrize(
    ("title", "expected_category", "expected_source"),
    [
        ("Software Engineer", "other", "tier15"),
        ("Founders Associate", "founders-associate", "tier1"),
        ("Investment Manager", "investment-analyst", "tier1"),
        ("Strategic Account Executive", "other", "tier15"),  # narrowed regex
    ],
)
def test_audit_categories_match_classify_title(
    tmp_path: Path,
    title: str,
    expected_category: str,
    expected_source: str,
) -> None:
    rows = [(str(uuid.uuid4()), title)]
    rc = _run_cli([], rows=rows, audit_dir=tmp_path)
    assert rc == 0
    audit = next(iter(tmp_path.glob("classify-*.csv"))).read_text()
    assert expected_category in audit
    assert expected_source in audit
