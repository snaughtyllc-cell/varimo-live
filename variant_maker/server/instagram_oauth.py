"""Instagram Login OAuth for Studio Insights.

Unlike Drive (one shared Google mailbox, site-admin Connect), a workspace can
Connect **many** professional Instagram accounts. Each Connect adds an
`account_{user_id}.json` — testers / main / trial / growth — and never
replaces the others.

The long Meta “generate token” string is the OAuth code exchange. Studio’s
callback stores it; operators do not paste it. Tester invite accept on
Instagram is still required (Standard Access).
"""
from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .drive_oauth import (
    OAuthPendingStore,
    new_oauth_state,
    public_request_base,
    studio_origin_from_redirect_uri,
)

ENV_APP_ID = "VARIANT_IG_APP_ID"
ENV_APP_SECRET = "VARIANT_IG_APP_SECRET"
ENV_REDIRECT_URI = "VARIANT_IG_REDIRECT_URI"

SCOPES = [
    "instagram_business_basic",
    "instagram_business_manage_insights",
]
AUTH_URI = "https://www.instagram.com/oauth/authorize"
TOKEN_URI = "https://api.instagram.com/oauth/access_token"
GRAPH_HOST = "https://graph.instagram.com"

ExchangeFn = Callable[..., dict[str, Any]]
FetchProfileFn = Callable[[str], dict[str, Any]]
ListMediaFn = Callable[[str, str], list[dict[str, Any]]]
FetchInsightsFn = Callable[[str, str], dict[str, int]]


def oauth_client_configured(environ: Mapping[str, str]) -> bool:
    return bool((environ.get(ENV_APP_ID) or "").strip() and (environ.get(ENV_APP_SECRET) or "").strip())


def resolve_redirect_uri(
    environ: Mapping[str, str],
    *,
    request_base: str | None = None,
    explicit: str | None = None,
) -> str:
    if explicit:
        return explicit.rstrip("/")
    env_uri = (environ.get(ENV_REDIRECT_URI) or "").strip()
    if env_uri:
        return env_uri.rstrip("/")
    if request_base:
        return f"{request_base.rstrip('/')}/api/instagram/oauth/callback"
    return "http://127.0.0.1:8000/api/instagram/oauth/callback"


def build_authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    scopes: list[str] | None = None,
) -> str:
    qs = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": ",".join(scopes or SCOPES),
        "force_reauth": "true",
        "state": state,
    })
    return f"{AUTH_URI}?{qs}"


def _now_utc() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(resp) -> dict[str, Any]:
    raw = json.loads(resp.read().decode())
    if not isinstance(raw, dict):
        raise TypeError("Instagram returned a non-object payload")
    return raw


def _urlopen_json(url: str, *, data: bytes | None = None, timeout: int = 20) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urlopen(req, timeout=timeout) as resp:
            return _read_json(resp)
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode()[:400]
        except OSError:
            detail = str(exc)
        raise ValueError(f"Instagram HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise ValueError(f"Instagram request failed: {exc.reason}") from exc


def _token_fields(body: Mapping[str, Any]) -> tuple[str, str]:
    """Short-lived token + user_id from either the old or data[] token payload."""
    access = body.get("access_token")
    user_id = body.get("user_id") or body.get("user_id".upper())
    data = body.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        row = data[0]
        if not isinstance(access, str):
            access = row.get("access_token")
        if user_id is None:
            user_id = row.get("user_id")
    if not isinstance(access, str) or not access:
        raise ValueError("Instagram did not return an access token")
    return access, str(user_id or "")


def exchange_code_for_token(
    *,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    post_form: Callable[[str, Mapping[str, str]], Mapping[str, Any]] | None = None,
    get_json: Callable[[str], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Auth code → short-lived token → long-lived token (no paste)."""

    def _post(url: str, fields: Mapping[str, str]) -> Mapping[str, Any]:
        return _urlopen_json(url, data=urlencode(dict(fields)).encode())

    def _get(url: str) -> Mapping[str, Any]:
        return _urlopen_json(url)

    body = (post_form or _post)(TOKEN_URI, {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
        "code": code,
    })
    short, user_id = _token_fields(body)
    long_url = (
        f"{GRAPH_HOST}/access_token?grant_type=ig_exchange_token&"
        + urlencode({"client_secret": client_secret, "access_token": short})
    )
    try:
        long_body = (get_json or _get)(long_url)
        long_token = long_body.get("access_token")
        expires_in = long_body.get("expires_in")
        if not isinstance(long_token, str) or not long_token:
            long_token = short
    except ValueError:
        long_token = short
        expires_in = None
    out: dict[str, Any] = {
        "access_token": long_token,
        "user_id": user_id,
        "token_type": "bearer",
        "obtained_at": _now_utc(),
    }
    if isinstance(expires_in, (int, float)):
        out["expires_in"] = int(expires_in)
    return out


def fetch_profile(
    access_token: str,
    *,
    get_json: Callable[[str], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    qs = urlencode({"fields": "user_id,username,name,account_type", "access_token": access_token})
    body = (get_json or (lambda url: _urlopen_json(url)))(f"{GRAPH_HOST}/me?{qs}")
    user_id = body.get("user_id") or body.get("id")
    username = body.get("username")
    if not user_id:
        raise ValueError("Instagram profile is missing user_id")
    return {
        "user_id": str(user_id),
        "username": username if isinstance(username, str) else "",
        "name": body.get("name") if isinstance(body.get("name"), str) else "",
        "account_type": body.get("account_type") if isinstance(body.get("account_type"), str) else "",
    }


@dataclass
class InstagramAccount:
    user_id: str
    username: str
    name: str
    connected_utc: str | None = None

    def public_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "name": self.name,
            "connected_utc": self.connected_utc,
        }


class InstagramAccountStore:
    """One JSON file per connected professional account (multi-tester)."""

    def __init__(self, directory: str) -> None:
        self._dir = directory

    @property
    def directory(self) -> str:
        return self._dir

    def _path(self, user_id: str) -> str:
        safe = "".join(ch for ch in user_id if ch.isalnum() or ch in ("-", "_"))
        if not safe:
            raise ValueError("invalid Instagram user id")
        return os.path.join(self._dir, f"account_{safe}.json")

    def list_accounts(self) -> list[InstagramAccount]:
        if not os.path.isdir(self._dir):
            return []
        out: list[InstagramAccount] = []
        for name in sorted(os.listdir(self._dir)):
            if not name.startswith("account_") or not name.endswith(".json"):
                continue
            path = os.path.join(self._dir, name)
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            user_id = str(data.get("user_id") or "")
            if not user_id:
                continue
            out.append(InstagramAccount(
                user_id=user_id,
                username=str(data.get("username") or ""),
                name=str(data.get("name") or ""),
                connected_utc=data.get("connected_utc") if isinstance(data.get("connected_utc"), str) else None,
            ))
        return out

    def load(self, user_id: str) -> dict[str, Any] | None:
        path = self._path(user_id)
        if not os.path.isfile(path):
            return None
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def save(self, data: Mapping[str, Any]) -> InstagramAccount:
        user_id = str(data.get("user_id") or "")
        if not user_id:
            raise ValueError("Instagram token is missing user_id")
        os.makedirs(self._dir, exist_ok=True)
        payload = dict(data)
        payload.setdefault("connected_utc", _now_utc())
        path = self._path(user_id)
        fd, tmp = tempfile.mkstemp(dir=self._dir, prefix=".ig-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            os.replace(tmp, path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
        return InstagramAccount(
            user_id=user_id,
            username=str(payload.get("username") or ""),
            name=str(payload.get("name") or ""),
            connected_utc=payload.get("connected_utc") if isinstance(payload.get("connected_utc"), str) else None,
        )

    def remove(self, user_id: str) -> bool:
        path = self._path(user_id)
        try:
            os.remove(path)
            return True
        except FileNotFoundError:
            return False

    def tokens(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for acc in self.list_accounts():
            data = self.load(acc.user_id)
            if data and isinstance(data.get("access_token"), str):
                out.append(data)
        return out


def status_payload(store: InstagramAccountStore, environ: Mapping[str, str]) -> dict[str, Any]:
    accounts = [a.public_dict() for a in store.list_accounts()]
    available = oauth_client_configured(environ)
    if accounts:
        message = (
            f"{len(accounts)} Instagram account"
            f"{'' if len(accounts) == 1 else 's'} connected — Connect another tester anytime"
        )
    elif available:
        message = (
            "Connect Instagram (tester accounts). Accept the Instagram tester invite first, "
            "then tap Connect — Studio stores the token. Do not paste a Meta generate-token string."
        )
    else:
        message = (
            "Instagram app not set on this Pod — ask an admin to set "
            "VARIANT_IG_APP_ID / VARIANT_IG_APP_SECRET"
        )
    return {
        "oauth_available": available,
        "connected": bool(accounts),
        "accounts": accounts,
        "message": message,
    }


__all__ = [
    "AUTH_URI",
    "ENV_APP_ID",
    "ENV_APP_SECRET",
    "ENV_REDIRECT_URI",
    "GRAPH_HOST",
    "SCOPES",
    "InstagramAccount",
    "InstagramAccountStore",
    "OAuthPendingStore",
    "build_authorization_url",
    "exchange_code_for_token",
    "fetch_profile",
    "new_oauth_state",
    "oauth_client_configured",
    "public_request_base",
    "resolve_redirect_uri",
    "status_payload",
    "studio_origin_from_redirect_uri",
    "urlparse",
]
