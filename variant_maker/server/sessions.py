"""HMAC-signed session cookie for Studio login. Stdlib only."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

COOKIE_NAME = "vf_session"
VIEW_COOKIE_NAME = "vf_admin_view"
SECRET_ENV = "VARIANT_AUTH_SECRET"
DEFAULT_TTL_S = 7 * 24 * 3600


def _encode(payload: dict[str, Any], secret: str) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _decode(token: str | None, secret: str, *, now: float | None = None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expect = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(body.encode()))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    exp = payload.get("exp")
    ts = now if now is not None else time.time()
    if not isinstance(exp, (int, float)) or ts >= float(exp):
        return None
    return payload


def load_or_create_secret(path: str, environ: dict | None = None) -> str:
    env = environ if environ is not None else os.environ
    raw = (env.get(SECRET_ENV) or "").strip()
    if raw:
        return raw
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            text = f.read().strip()
        if text:
            return text
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    secret = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(secret)
    return secret


def sign_session(
    *,
    email: str,
    workspace_id: str,
    secret: str,
    ttl_s: int = DEFAULT_TTL_S,
    now: float | None = None,
) -> str:
    payload = {
        "email": email.strip().lower(),
        "iat": now if now is not None else time.time(),
        "workspace_id": workspace_id,
        "exp": int((now if now is not None else time.time()) + ttl_s),
    }
    return _encode(payload, secret)


def read_session(token: str | None, secret: str, *, now: float | None = None) -> dict[str, Any] | None:
    payload = _decode(token, secret, now=now)
    if payload is None:
        return None
    email = payload.get("email")
    workspace_id = payload.get("workspace_id")
    if not isinstance(email, str) or not isinstance(workspace_id, str):
        return None
    if not email or not workspace_id:
        return None
    return {"email": email, "workspace_id": workspace_id, "exp": int(payload["exp"]), "iat": payload.get("iat")}


def sign_view(workspace_id: str, secret: str, *, ttl_s: int = DEFAULT_TTL_S,
              now: float | None = None) -> str:
    payload = {
        "kind": "view",
        "workspace_id": workspace_id,
        "exp": int((now if now is not None else time.time()) + ttl_s),
    }
    return _encode(payload, secret)


def read_view(token: str | None, secret: str, *, now: float | None = None) -> str | None:
    payload = _decode(token, secret, now=now)
    if payload is None or payload.get("kind") != "view":
        return None
    workspace_id = payload.get("workspace_id")
    if not isinstance(workspace_id, str) or not workspace_id:
        return None
    return workspace_id
