"""Opt-in, expiring HQ credentials. Configuration holds SHA256 digests, never keys."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re


def authenticate(header: str, raw_config: str, now: float) -> dict | None:
    if not header.startswith("Bearer ") or not 32 <= len(header[7:]) <= 256:
        return None
    digest = hashlib.sha256(header[7:].encode()).hexdigest()
    try:
        entries = json.loads(raw_config or "[]")
        if not isinstance(entries, list) or len(entries) > 32:
            return None
        matches = []
        for row in entries:
            if not isinstance(row, dict):
                return None
            stored = row.get("sha256", "")
            if not isinstance(stored, str) or not re.fullmatch("[a-f0-9]{64}", stored):
                return None
            if hmac.compare_digest(stored, digest):
                matches.append(row)
        if len(matches) != 1:
            return None
        row = matches[0]
        expiry = row.get("expires_at")
        if type(expiry) not in (int, float) or not math.isfinite(expiry) or now >= expiry:
            return None
        if row.get("scope") != "varimo:jobs":
            return None
        if not all(isinstance(row.get(k), str) and row[k] for k in ("workspace_id", "email")):
            return None
        model_scope = row.get("model_scope", "named")
        if model_scope == "workspace":
            # Explicit workspace-wide access; never infer it from a missing list.
            return row if "models" not in row else None
        if model_scope != "named":
            return None
        models = row.get("models")
        if not isinstance(models, list) or not models or len(models) > 100:
            return None
        if not all(isinstance(x, str) and x and x != "*" for x in models):
            return None
        return row
    except (ValueError, TypeError):
        return None
