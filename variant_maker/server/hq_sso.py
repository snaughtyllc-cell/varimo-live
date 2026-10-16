"""HQ handoff login. Stdlib HS256 JWT. The token is never logged.

The HMAC key is the ``VARIMO_SSO_SECRET`` string as UTF-8. It is not
base64-decoded. HQ must sign with that same string (jose ``TextEncoder``,
PyJWT string key). A missing or short secret disables the route.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import tempfile
import threading
import time
from collections.abc import Mapping
from typing import Any

from .tenants import _EMAIL_RE, normalize_email

SSO_SECRET_ENV = "VARIMO_SSO_SECRET"
MIN_SECRET_CHARS = 32
CLOCK_SKEW_S = 30
MAX_TTL_S = 60 + CLOCK_SKEW_S
MAX_BODY_BYTES = 8192
MAX_TOKEN_CHARS = 4096

_JTI_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_ISSUER = "hq"
_AUDIENCE = "varimo"
_ROLES = frozenset({"admin", "partner", "va"})


class HqSsoError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def read_sso_secret(environ: Mapping[str, str] | None) -> str | None:
    raw = ((environ or {}).get(SSO_SECRET_ENV) or "").strip()
    if len(raw) < MIN_SECRET_CHARS:
        return None
    try:
        raw.encode("ascii")
    except UnicodeEncodeError:
        return None
    return raw


def wall_now() -> float:
    return time.time()


def sso_failure(code: str) -> tuple[int, str]:
    if code == "disabled":
        return 404, "not found"
    if code == "unknown_email":
        return 403, "This email isn't invited. Ask the operator to add you."
    if code == "expired":
        return 401, "Sign-in link expired. Open Varimo from HQ again."
    if code == "replay":
        return 401, "This sign-in link was already used. Open Varimo from HQ again."
    if code == "unavailable":
        return 503, "Sign-in is temporarily unavailable."
    return 401, "Sign-in link is not valid."


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    if not segment or any(c.isspace() for c in segment):
        raise ValueError("empty")
    pad = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + pad)


def sign_hq_token(payload: Mapping[str, Any], secret: str) -> str:
    """Test/helper signer. Production HQ mints the token; Varimo only verifies."""
    if not secret:
        raise HqSsoError("invalid")
    header = {"alg": "HS256", "typ": "JWT"}
    signing = ".".join((
        _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url(json.dumps(dict(payload), separators=(",", ":")).encode("utf-8")),
    ))
    sig = hmac.new(secret.encode("utf-8"), signing.encode("ascii"), hashlib.sha256).digest()
    return f"{signing}.{_b64url(sig)}"


def parse_token_body(raw: bytes) -> str:
    if not isinstance(raw, (bytes, bytearray)) or len(raw) > MAX_BODY_BYTES:
        raise HqSsoError("invalid")
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeError, ValueError):
        raise HqSsoError("invalid") from None
    if not isinstance(data, dict):
        raise HqSsoError("invalid")
    token = data.get("token")
    if not isinstance(token, str):
        raise HqSsoError("invalid")
    token = token.strip()
    if not token or len(token) > MAX_TOKEN_CHARS or token.count(".") != 2:
        raise HqSsoError("invalid")
    try:
        token.encode("ascii")
    except UnicodeEncodeError:
        raise HqSsoError("invalid") from None
    return token


def _number(value: object) -> float | None:
    if type(value) not in (int, float):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def verify_hq_token(token: str, secret: str, *, now: float) -> dict[str, Any]:
    """Return checked claims. Raises HqSsoError. Does not record the jti."""
    if not secret or not isinstance(token, str) or token.count(".") != 2:
        raise HqSsoError("invalid")
    header_b64, payload_b64, sig_b64 = token.split(".")
    try:
        header = json.loads(_b64url_decode(header_b64))
        signature = _b64url_decode(sig_b64)
    except (ValueError, json.JSONDecodeError, UnicodeError):
        raise HqSsoError("invalid") from None
    if not isinstance(header, dict) or header.get("alg") != "HS256":
        raise HqSsoError("invalid")
    if header.get("typ") not in (None, "JWT"):
        raise HqSsoError("invalid")
    signing = f"{header_b64}.{payload_b64}".encode("ascii")
    expect = hmac.new(secret.encode("utf-8"), signing, hashlib.sha256).digest()
    try:
        match = hmac.compare_digest(signature, expect)
    except (TypeError, ValueError):
        match = False
    if not match:
        raise HqSsoError("invalid")
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError, UnicodeError):
        raise HqSsoError("invalid") from None
    if not isinstance(payload, dict):
        raise HqSsoError("invalid")
    if payload.get("iss") != _ISSUER or payload.get("aud") != _AUDIENCE:
        raise HqSsoError("invalid")
    iat = _number(payload.get("iat"))
    exp = _number(payload.get("exp"))
    if iat is None or exp is None or exp <= iat:
        raise HqSsoError("invalid")
    if now > exp + CLOCK_SKEW_S:
        raise HqSsoError("expired")
    if iat > now + CLOCK_SKEW_S or (exp - iat) > MAX_TTL_S:
        raise HqSsoError("invalid")
    nbf = payload.get("nbf")
    if nbf is not None:
        nbf_n = _number(nbf)
        if nbf_n is None or nbf_n > now + CLOCK_SKEW_S:
            raise HqSsoError("invalid")
    email = payload.get("email")
    if not isinstance(email, str):
        raise HqSsoError("invalid")
    email = normalize_email(email)
    if not _EMAIL_RE.match(email):
        raise HqSsoError("invalid")
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.strip() or len(sub) > 200:
        raise HqSsoError("invalid")
    jti = payload.get("jti")
    if not isinstance(jti, str) or _JTI_RE.fullmatch(jti) is None:
        raise HqSsoError("invalid")
    name = payload.get("name", "")
    if not isinstance(name, str) or len(name) > 200:
        raise HqSsoError("invalid")
    role = payload.get("role")
    if role not in _ROLES:
        raise HqSsoError("invalid")
    return {
        "email": email,
        "sub": sub.strip(),
        "jti": jti,
        "exp": exp,
        "iat": iat,
        "name": name,
        "role": role,
    }


class JtiStore:
    """Remember used jti values until exp + clock skew. File-backed, one process lock."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()

    def consume(self, jti: str, exp: float, *, now: float) -> bool:
        """True when this jti was recorded for the first time."""
        with self._lock:
            kept = self._live(now)
            if jti in kept:
                return False
            kept[jti] = float(exp)
            self._save(kept)
            return True

    def _live(self, now: float) -> dict[str, float]:
        raw = self._load()
        kept: dict[str, float] = {}
        for key, value in raw.items():
            number = _number(value)
            if not isinstance(key, str) or number is None:
                continue
            if number + CLOCK_SKEW_S >= now:
                kept[key] = number
        return kept

    def _load(self) -> dict:
        if not os.path.isfile(self._path):
            return {}
        try:
            with open(self._path, encoding="utf-8") as handle:
                raw = json.load(handle)
        except (OSError, json.JSONDecodeError, UnicodeError, ValueError):
            raise HqSsoError("unavailable") from None
        if not isinstance(raw, dict):
            raise HqSsoError("unavailable")
        return raw

    def _save(self, data: dict[str, float]) -> None:
        directory = os.path.dirname(self._path) or "."
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".hq-sso-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, separators=(",", ":"))
            os.replace(tmp, self._path)
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise HqSsoError("unavailable") from None
