"""Privacy-safe failure telemetry: fixed labels only, never raw diagnostic text.

This intentionally favors an unknown category over regex-redacting arbitrary
stderr/HTTP bodies. Those can include signed URLs, filenames, subtitles, API
keys, and credentials in formats that a denylist cannot reliably recognize.
"""
from __future__ import annotations

import json

# Matching is a diagnostic hint, not a definitive cause or a retry instruction.
_PATTERNS = (
    ("memory", ("out of memory", "cannot allocate memory", "oom")),
    ("disk_full", ("no space left on device",)),
    ("permission", ("permission denied", "access denied")),
    ("missing_file", ("no such file or directory",)),
    ("missing_filter", ("no such filter", "filter not found")),
    ("invalid_media", ("invalid data found", "moov atom not found")),
    ("invalid_argument", ("invalid argument",)),
    ("encoder", ("error opening encoder", "unknown encoder")),
    ("filter_configuration", ("failed to configure", "error reinitializing filters")),
    ("resource_unavailable", ("resource temporarily unavailable",)),
    ("timeout", ("timed out", "timed_out", "execution timeout")),
    ("authorization", ("unauthorized", "invalid api key", "forbidden")),
    ("endpoint_unavailable", ("endpoint is not ready", "endpoint not found", "endpoint is disabled")),
    ("capacity", ("no workers available", "no available workers", "insufficient capacity")),
    ("conflict", ("conflict",)),
)
_STAGES = frozenset(("ffmpeg", "runpod_submit", "runpod_stream", "runpod_status", "runpod_failed"))


def failure_diagnostic(stage: str, detail: object, code: int | None = None) -> str:
    """Bounded, fixed-schema JSON; never stringify an arbitrary object."""
    if isinstance(detail, bytes):
        detail = detail[:8192].decode("utf-8", errors="replace")
    text = detail[:8192].lower() if isinstance(detail, str) else ""
    hints = [label for label, needles in _PATTERNS if any(n in text for n in needles)]
    result = {"event": "render_failure_diagnostic", "stage": stage if stage in _STAGES else "unknown",
              "hints": hints or ["unknown"]}
    # bool is an int subclass; accept only bounded actual integer status values.
    if type(code) is int and -65536 <= code <= 65536:
        result["code"] = code
    return json.dumps(result, separators=(",", ":"))


def log_http_failure(response, stage: str) -> None:
    """Inspect only failed responses. No extra network calls or retry changes."""
    code = getattr(response, "status_code", None)
    if type(code) is int and 400 <= code <= 599:
        print(failure_diagnostic(stage, getattr(response, "text", ""), code), flush=True)
