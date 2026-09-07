"""Monthly ok-copy ledger survives Gallery prune and does not double-count."""
from __future__ import annotations

from variant_maker.server.usage import (
    count_ok_this_month,
    month_key,
    record_ok_copies,
)


def test_month_key_is_utc_year_month():
    import datetime as dt
    now = dt.datetime(2026, 9, 7, 12, 0, tzinfo=dt.UTC)
    assert month_key(now) == "2026-09"


def test_ledger_counts_ok_copies_for_this_month_only(tmp_path):
    path = tmp_path / "usage.jsonl"
    record_ok_copies(
        str(path),
        copies=[("src_a", 0), ("src_a", 1), ("src_a", 2), ("src_a", 3),
                ("src_a", 4), ("src_a", 5), ("src_a", 6), ("src_a", 7)],
        month="2026-09",
    )
    record_ok_copies(str(path), copies=[("old", 0)], month="2026-08")
    assert count_ok_this_month(str(path), month="2026-09") == 8
    assert count_ok_this_month(str(path), month="2026-08") == 1


def test_ledger_dedupes_the_same_source_index(tmp_path):
    path = tmp_path / "usage.jsonl"
    record_ok_copies(str(path), copies=[("src_a", 0), ("src_a", 1)], month="2026-09")
    record_ok_copies(str(path), copies=[("src_a", 0), ("src_a", 2)], month="2026-09")
    assert count_ok_this_month(str(path), month="2026-09") == 3


def test_missing_ledger_is_zero(tmp_path):
    assert count_ok_this_month(str(tmp_path / "missing.jsonl"), month="2026-09") == 0
