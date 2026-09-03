"""Auth middleware helpers: contextvar tenant + JobStore proxy."""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from .jobs import JobStore
from .tenant_runtime import TenantBundle

tenant_cv: ContextVar[TenantBundle | None] = ContextVar("vf_tenant", default=None)

PUBLIC_API_PATHS = frozenset({
    "/api/health",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/password",
    "/api/auth/google/start",
    "/api/auth/google/callback",
    # Instagram returns here from instagram.com; browsers often omit SameSite=Lax cookies.
    "/api/instagram/oauth/callback",
})


class JobStoreProxy:
    """Forwards to the request tenant JobStore, else the create_app fallback."""

    def __init__(self, fallback: JobStore) -> None:
        object.__setattr__(self, "_fallback", fallback)

    def _inner(self) -> JobStore:
        bundle = tenant_cv.get()
        if bundle is not None:
            return bundle.store
        return object.__getattribute__(self, "_fallback")

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner(), name)


class AttrProxy:
    """Forwards DestinationStore / CaptionStore / etc. to the request tenant."""

    def __init__(self, attr: str, fallback: Any) -> None:
        object.__setattr__(self, "_attr", attr)
        object.__setattr__(self, "_fallback", fallback)

    def _inner(self) -> Any:
        bundle = tenant_cv.get()
        if bundle is not None:
            return getattr(bundle, object.__getattribute__(self, "_attr"))
        return object.__getattribute__(self, "_fallback")

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner(), name)


def current_bundle() -> TenantBundle | None:
    return tenant_cv.get()
