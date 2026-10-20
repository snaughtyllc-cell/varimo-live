"""Per-source Reel copy counter.

A second Generate on the same file continues at the next copy number so the
ten rows are not reprinted from copy 1.
"""
from __future__ import annotations

import contextvars
import json
import os

_COPY_START: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "reel_copy_start", default=None,
)


def set_copy_start(n: int) -> contextvars.Token:
    return _COPY_START.set(int(n))


def reset_copy_start(token: contextvars.Token) -> None:
    _COPY_START.reset(token)


def get_copy_start() -> int | None:
    return _COPY_START.get()


def allocate(root: str, source_sha: str, count: int) -> int:
    """Return the 1-based copy number for the first variant in this batch."""
    n = int(count)
    if n < 1:
        raise ValueError("count must be positive")
    sha = str(source_sha or "").strip().lower()
    if not sha:
        raise ValueError("source hash required")
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, "reel_copies.json")
    lock_path = path + ".lock"
    with open(lock_path, "a", encoding="utf-8") as lock:
        try:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        except ImportError:
            fcntl = None  # pragma: no cover
        try:
            data: dict = {}
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    raw = fh.read()
                if raw.strip():
                    loaded = json.loads(raw)
                    if isinstance(loaded, dict):
                        data = loaded
            current = max(int(data.get(sha) or 1), 1)
            data[sha] = current + n
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            os.replace(tmp, path)
            return current
        finally:
            if fcntl is not None:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
