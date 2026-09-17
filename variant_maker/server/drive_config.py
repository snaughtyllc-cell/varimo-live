from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from .drive_oauth import OAuthTokenStore, oauth_client_configured

ENV_SA_JSON = "VARIANT_DRIVE_SERVICE_ACCOUNT_JSON"
ENV_OAUTH_CLIENT_ID = "VARIANT_DRIVE_OAUTH_CLIENT_ID"
ENV_OAUTH_CLIENT_SECRET = "VARIANT_DRIVE_OAUTH_CLIENT_SECRET"
ENV_OAUTH_REDIRECT_URI = "VARIANT_DRIVE_OAUTH_REDIRECT_URI"
ENV_SHARE_EMAIL = "VARIANT_DRIVE_SHARE_EMAIL"
ENV_STUDIO_OAUTH_TOKEN = "VARIANT_DRIVE_STUDIO_OAUTH_TOKEN"
DEFAULT_SHARE_EMAIL = "studio@varimo.io"

DriveStatus = Literal["ready", "not_configured", "auth_failed"]
AuthMode = Literal["oauth", "service_account"]


@dataclass(frozen=True)
class DriveConfigInfo:
    status: DriveStatus
    sa_email: str | None
    message: str
    auth_mode: AuthMode | None = None
    connected_email: str | None = None
    oauth_available: bool = False


def read_share_email(environ: Mapping[str, str] | None = None) -> str:
    """Human mailbox operators share folders with. Never Jeff's Gmail, never the SA robot."""
    env = environ if environ is not None else os.environ
    raw = (env.get(ENV_SHARE_EMAIL) or "").strip()
    return raw or DEFAULT_SHARE_EMAIL


def studio_oauth_token_path(data_dir: str, environ: Mapping[str, str] | None = None) -> str:
    """Site-level studio@ token. Override with VARIANT_DRIVE_STUDIO_OAUTH_TOKEN."""
    env = environ if environ is not None else os.environ
    raw = (env.get(ENV_STUDIO_OAUTH_TOKEN) or "").strip()
    if raw:
        return raw
    return os.path.join(os.path.abspath(data_dir), "auth", "studio_oauth_token.json")


def oauth_token_is_usable(path: str | None) -> bool:
    """True when the file exists and has a refresh_token or token (same as resolve_drive_status)."""
    if not path:
        return False
    store = OAuthTokenStore(path)
    if not store.exists():
        return False
    try:
        data = store.load()
    except (OSError, json.JSONDecodeError, ValueError):
        return False
    return bool(data.get("refresh_token") or data.get("token"))


def token_email_matches_share(path: str | None, environ: Mapping[str, str] | None = None) -> bool:
    """True when the token file is the studio mailbox people share folders with."""
    if not path:
        return False
    email = OAuthTokenStore(path).read_email()
    if not isinstance(email, str) or not email.strip():
        return False
    return email.strip().lower() == read_share_email(environ).lower()


def resolve_drive_oauth_token_path(
    *,
    data_dir: str,
    workspace_token_path: str | None = None,
    admin_token_paths: list[str] | None = None,
    environ: Mapping[str, str] | None = None,
    auth_on: bool = False,
) -> str | None:
    """Pick the one studio@ Drive token used by every workspace.

    Auth off: today's single-workspace path.
    Auth on: the site studio@ file, else an admin workspace token that is
    signed in as the share mailbox. Never a customer token. Never a personal Gmail.
    """
    if not auth_on:
        return workspace_token_path
    site = studio_oauth_token_path(data_dir, environ)
    if oauth_token_is_usable(site):
        return site
    for path in admin_token_paths or ():
        if oauth_token_is_usable(path) and token_email_matches_share(path, environ):
            return path
    return None


def read_sa_email(sa_json_path: str) -> str | None:
    try:
        with open(sa_json_path) as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    email = data.get("client_email") if isinstance(data, dict) else None
    return email if isinstance(email, str) and email else None


def _sa_info(path: str) -> DriveConfigInfo:
    if not os.path.isfile(path):
        return DriveConfigInfo(
            "auth_failed", None,
            f"Drive service account JSON unreadable: {path}",
            oauth_available=False,
        )
    email = read_sa_email(path)
    if email is None:
        return DriveConfigInfo(
            "auth_failed", None,
            f"Drive service account JSON invalid or missing client_email: {path}",
            oauth_available=False,
        )
    return DriveConfigInfo(
        "ready", email, "Drive ready",
        auth_mode="service_account",
        connected_email=email,
        oauth_available=False,
    )


def resolve_drive_status(
    sa_json_path: str | None = None,
    *,
    oauth_token_path: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> DriveConfigInfo:
    """Resolve Studio Drive readiness.

    Preference order: usable OAuth refresh token → service account JSON → not configured.
    """
    env = environ if environ is not None else os.environ
    oauth_ok = oauth_client_configured(env)

    if oauth_token_path:
        store = OAuthTokenStore(oauth_token_path)
        if store.exists():
            email = store.read_email()
            try:
                data = store.load()
            except (OSError, json.JSONDecodeError, ValueError):
                return DriveConfigInfo(
                    "auth_failed", None,
                    f"Drive OAuth token unreadable: {oauth_token_path}",
                    oauth_available=oauth_ok,
                )
            if not data.get("refresh_token") and not data.get("token"):
                return DriveConfigInfo(
                    "auth_failed", None,
                    f"Drive OAuth token missing credentials: {oauth_token_path}",
                    oauth_available=oauth_ok,
                )
            return DriveConfigInfo(
                "ready", email, "Drive ready (Google OAuth)",
                auth_mode="oauth",
                connected_email=email,
                oauth_available=True,
            )

    path = sa_json_path if sa_json_path is not None else env.get(ENV_SA_JSON)
    if path:
        info = _sa_info(path)
        return DriveConfigInfo(
            info.status, info.sa_email, info.message,
            auth_mode=info.auth_mode,
            connected_email=info.connected_email,
            oauth_available=oauth_ok,
        )

    share = read_share_email(env)
    if oauth_ok:
        return DriveConfigInfo(
            "not_configured", None,
            f"Drive not connected — share the folder as Editor with {share}; "
            "site admin connects the studio account",
            oauth_available=True,
        )
    return DriveConfigInfo(
        "not_configured", None,
        f"Drive not configured — share the folder as Editor with {share}, "
        "or set VARIANT_DRIVE_SERVICE_ACCOUNT_JSON",
        oauth_available=False,
    )
