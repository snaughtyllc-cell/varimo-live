"""Workspace monthly usage ledger. Survives Gallery prune. Counts ok copies."""
from __future__ import annotations

import datetime as _dt
import json
import os
import threading

_lock = threading.Lock()


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
    target = month or month_key()
    seen: set[str] = set()
    total = 0
    for row in _iter_rows(path):
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
