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


def test_union_counts_gallery_copies_the_ledger_does_not_have(tmp_path):
    from variant_maker.server.usage import count_ok_union
    path = tmp_path / "usage.jsonl"
    record_ok_copies(str(path), copies=[("src_a", 0), ("src_a", 1)], month="2026-09")
    extra = [("src_a", 1), ("src_a", 2), ("src_b", 0)]
    assert count_ok_union(str(path), extra, month="2026-09") == 4


def test_record_fast_job_is_once_per_job_and_skips_hq(tmp_path):
    from variant_maker.server.usage import record_fast_job

    path = tmp_path / "usage.jsonl"
    assert record_fast_job(
        str(path),
        job_id="fast1",
        quality_mode="fast",
        real_work_s=90,
        utc="2026-09-10T12:00:00Z",
        submitted_utc="2026-09-10T11:58:30Z",
        completed_utc="2026-09-10T12:00:00Z",
    )
    assert record_fast_job(
        str(path), job_id="fast1", quality_mode="fast", real_work_s=12,
    ) is False
    assert record_fast_job(
        str(path), job_id="hq1", quality_mode="hq", real_work_s=600,
    ) is False
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from variant_maker.server.billing import period_fast_seconds

    ws = SimpleNamespace(usage_path=str(path))
    now = datetime(2026, 9, 10, 13, tzinfo=UTC)
    assert period_fast_seconds(ws, start=now - timedelta(days=1), end=now) == 90
    assert count_ok_this_month(str(path), month="2026-09") == 0


def test_period_fast_seconds_includes_running_fast_job(tmp_path):
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from variant_maker.server.billing import period_fast_seconds
    from variant_maker.server.usage import record_fast_job

    now = datetime(2026, 9, 10, 12, tzinfo=UTC)
    path = tmp_path / "usage.jsonl"
    record_fast_job(
        str(path),
        job_id="done1",
        quality_mode="fast",
        real_work_s=90,
        utc=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    running = SimpleNamespace(
        quality_mode="fast",
        state="running",
        created_utc=(now - timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    ws = SimpleNamespace(usage_path=str(path))
    seconds = period_fast_seconds(
        ws,
        start=now - timedelta(days=1),
        end=now + timedelta(hours=1),
        jobs=[running],
        now=now,
    )
    assert seconds == 120


def test_remaining_pct_drains_from_100_to_0():
    from variant_maker.server.plans import remaining_pct
    assert remaining_pct(used_variants=0, included_variants=96) == 100
    assert remaining_pct(used_variants=48, included_variants=96) == 50
    assert remaining_pct(used_variants=96, included_variants=96) == 0
    assert remaining_pct(used_variants=120, included_variants=96) == 0
    assert remaining_pct(used_variants=0, included_variants=0) == 0

