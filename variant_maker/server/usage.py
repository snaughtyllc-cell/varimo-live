"""Workspace monthly usage ledger. Survives Gallery prune. Counts ok copies."""
from __future__ import annotations

import datetime as _dt
import json
import os
import threading
from collections.abc import Iterable
from typing import Any

_lock = threading.Lock()
_IN_FLIGHT_STATES = frozenset({
    "queued", "reserved", "starting", "running", "uploading", "cancel_requested",
})


def month_key(now: _dt.datetime | None = None) -> str:
    stamp = now if now is not None else _dt.datetime.now(_dt.UTC)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=_dt.UTC)
    return stamp.astimezone(_dt.UTC).strftime("%Y-%m")


def _iter_rows(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(raw, dict):
            yield raw


def _row_key(row: dict) -> str:
    return f"{row.get('source_id')}:{row.get('index')}"


def count_ok_this_month(path: str, month: str | None = None) -> int:
    return count_ok_union(path, extra=(), month=month)


def count_ok_union(
    path: str,
    extra: list[tuple[str, int]] | tuple[tuple[str, int], ...] = (),
    month: str | None = None,
) -> int:
    """Ledger plus live Gallery ok copies. Same source+index counts once."""
    target = month or month_key()
    seen: set[str] = set()
    total = 0
    for row in _iter_rows(path):
        if str(row.get("kind") or "") == "fast_job":
            continue
        if row.get("source_id") is None:
            continue
        if str(row.get("month") or "") != target:
            continue
        key = _row_key(row)
        if key in seen:
            continue
        seen.add(key)
        try:
            total += max(1, int(row.get("n") or 1))
        except (TypeError, ValueError):
            total += 1
    for source_id, index in extra:
        key = f"{source_id}:{index}"
        if key in seen:
            continue
        seen.add(key)
        total += 1
    return total


def record_ok_copies(
    path: str,
    copies: list[tuple[str, int]],
    month: str | None = None,
) -> int:
    """Append newly delivered ok copies. Returns how many new rows were written."""
    if not copies:
        return 0
    target = month or month_key()
    with _lock:
        seen: set[str] = set()
        for row in _iter_rows(path):
            if str(row.get("kind") or "") == "fast_job":
                continue
            if str(row.get("month") or "") == target:
                seen.add(_row_key(row))
        new_rows: list[str] = []
        for source_id, index in copies:
            key = f"{source_id}:{index}"
            if key in seen:
                continue
            seen.add(key)
            new_rows.append(json.dumps({
                "month": target,
                "source_id": source_id,
                "index": int(index),
                "n": 1,
            }, separators=(",", ":")))
        if not new_rows:
            return 0
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(new_rows) + "\n")
        return len(new_rows)


def _parse_utc(value: str | None) -> _dt.datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = _dt.datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.UTC)
    return dt.astimezone(_dt.UTC)


def _job_ids(path: str) -> set[str]:
    ids: set[str] = set()
    for row in _iter_rows(path):
        job_id = str(row.get("job_id") or "").strip()
        if job_id:
            ids.add(job_id)
    return ids


def record_fast_job(
    path: str,
    *,
    job_id: str,
    quality_mode: str,
    real_work_s: float,
    utc: str | None = None,
    submitted_utc: str | None = None,
    completed_utc: str | None = None,
) -> bool:
    """One Fast-hour row per job. Copy-ledger rows stay pack counts."""
    if str(quality_mode or "").strip().lower() != "fast":
        return False
    key = str(job_id or "").strip()
    if not key:
        return False
    try:
        seconds = max(0.0, float(real_work_s or 0.0))
    except (TypeError, ValueError):
        return False
    when = utc or _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with _lock:
        if key in _job_ids(path):
            return False
        os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
        row = {
            "kind": "fast_job",
            "job_id": key,
            "quality_mode": "fast",
            "utc": when,
            "submitted_utc": submitted_utc or when,
            "completed_utc": completed_utc or when,
            "billed": {"real_work_s": seconds},
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")
    return True


def in_flight_fast_seconds(
    jobs: Iterable[Any] | None,
    *,
    now: _dt.datetime | None = None,
    start: _dt.datetime | None = None,
) -> float:
    """Elapsed Fast time on jobs that are still generating."""
    when = now if now is not None else _dt.datetime.now(_dt.UTC)
    if when.tzinfo is None:
        when = when.replace(tzinfo=_dt.UTC)
    else:
        when = when.astimezone(_dt.UTC)
    when_start = start
    if when_start is not None:
        if when_start.tzinfo is None:
            when_start = when_start.replace(tzinfo=_dt.UTC)
        else:
            when_start = when_start.astimezone(_dt.UTC)
    total = 0.0
    for job in jobs or ():
        if str(getattr(job, "quality_mode", "") or "").strip().lower() != "fast":
            continue
        if str(getattr(job, "state", "") or "") not in _IN_FLIGHT_STATES:
            continue
        started = _parse_utc(str(getattr(job, "created_utc", "") or ""))
        if started is None:
            continue
        if when_start is not None and started < when_start:
            started = when_start
        if started >= when:
            continue
        total += (when - started).total_seconds()
    return max(0.0, total)
