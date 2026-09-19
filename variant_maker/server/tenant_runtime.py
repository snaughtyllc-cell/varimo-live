"""Per-workspace JobStore + Drive/caption files. Request-scoped via request.state.tenant."""
from __future__ import annotations

import os
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from .captions import CaptionStore
from .destinations import DestinationStore
from .drive_config import resolve_drive_oauth_token_path, resolve_drive_status
from .drive_exports import ExportStore
from .drive_oauth import OAuthPendingStore, OAuthTokenStore
from .gallery_folders import GalleryFolderStore
from .instagram_oauth import InstagramAccountStore
from .jobs import JobStore
from .runner import Runner
from .tenants import is_admin_email, tenant_root
from .workflows import WorkflowStore
from .workspace import Workspace


@dataclass
class TenantBundle:
    workspace_id: str
    ws: Workspace
    store: JobStore
    destinations: DestinationStore
    captions: CaptionStore
    workflows: WorkflowStore
    gallery_folders: GalleryFolderStore
    exports: ExportStore
    oauth_token_store: OAuthTokenStore
    oauth_pending: OAuthPendingStore
    instagram_accounts: InstagramAccountStore
    instagram_pending: OAuthPendingStore
    drive: Any = None
    sheets: Any = None


class TenantHub:
    """Lazy JobStore per workspace_id. Same runner (Fast/HQ) for every tenant."""

    def __init__(self, data_dir: str, runner: Runner,
                 object_store=None, gallery_keep_jobs: int | None = None,
                 gallery_keep_hours: float | None = None,
                 quota_factory: Callable | None = None) -> None:
        self.data_dir = os.path.abspath(data_dir)
        self._runner = runner
        self._object_store = object_store
        self._gallery_keep_jobs = gallery_keep_jobs
        self._gallery_keep_hours = gallery_keep_hours
        self._quota_factory = quota_factory
        self._lock = threading.Lock()
        self._bundles: dict[str, TenantBundle] = {}
        self._on_bundle: Callable[[TenantBundle], None] | None = None

    def set_on_bundle(self, fn: Callable[[TenantBundle], None] | None) -> None:
        with self._lock:
            self._on_bundle = fn
            bundles = list(self._bundles.values())
        if fn is not None:
            for item in bundles:
                fn(item)

    def bundle(self, workspace_id: str) -> TenantBundle:
        created: TenantBundle | None = None
        with self._lock:
            existing = self._bundles.get(workspace_id)
            if existing is not None:
                return existing
            root = tenant_root(self.data_dir, workspace_id)
            ws = Workspace(root)
            quota_check = None
            if self._quota_factory is not None:
                quota_check = self._quota_factory(workspace_id, ws)
            store = JobStore(
                ws, self._runner,
                object_store=self._object_store,
                gallery_keep_jobs=self._gallery_keep_jobs,
                gallery_keep_hours=self._gallery_keep_hours,
                quota_check=quota_check,
            )
            built = TenantBundle(
                workspace_id=workspace_id,
                ws=ws,
                store=store,
                destinations=DestinationStore(ws.destinations_path()),
                captions=CaptionStore(ws.captions_path()),
                workflows=WorkflowStore(ws.workflows_path()),
                gallery_folders=GalleryFolderStore(ws.gallery_folders_path()),
                exports=ExportStore(ws.exports_dir()),
                oauth_token_store=OAuthTokenStore(ws.oauth_token_path()),
                oauth_pending=OAuthPendingStore(ws.oauth_pending_path()),
                instagram_accounts=InstagramAccountStore(ws.instagram_dir()),
                instagram_pending=OAuthPendingStore(ws.instagram_pending_path()),
            )
            self._bundles[workspace_id] = built
            created = built
            on_bundle = self._on_bundle
        # Hook first, then resume. hydrate_from_disk can finish a job on another
        # thread; Studio output upload must already be attached.
        if created is not None:
            if on_bundle is not None:
                on_bundle(created)
            created.store.hydrate_from_disk()
        return created

    def hydrate_all(self, workspace_ids: list[str]) -> None:
        for ws_id in workspace_ids:
            self.bundle(ws_id)


def admin_workspace_token_paths(
    data_dir: str,
    users: Iterable[Any],
    admin_email: str | None,
) -> list[str]:
    """`{tenants/{id}/drive/oauth_token.json}` for each site-admin user."""
    paths: list[str] = []
    seen: set[str] = set()
    for user in users:
        email = getattr(user, "email", None)
        workspace_id = getattr(user, "workspace_id", None)
        if not email or not workspace_id:
            continue
        if not is_admin_email(str(email), admin_email):
            continue
        path = os.path.join(tenant_root(data_dir, str(workspace_id)), "drive", "oauth_token.json")
        if path not in seen:
            seen.add(path)
            paths.append(path)
    return paths


def drive_ready(
    bundle: TenantBundle,
    *,
    sa_json_path: str | None,
    environ: dict,
    data_dir: str | None = None,
    auth_on: bool = False,
    admin_token_paths: list[str] | None = None,
):
    token_path = resolve_drive_oauth_token_path(
        data_dir=data_dir or "",
        workspace_token_path=bundle.ws.oauth_token_path(),
        admin_token_paths=admin_token_paths,
        environ=environ,
        auth_on=auth_on,
    )
    return resolve_drive_status(
        sa_json_path,
        oauth_token_path=token_path,
        environ=environ,
    )
