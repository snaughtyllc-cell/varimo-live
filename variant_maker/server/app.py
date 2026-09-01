"""FastAPI control-plane app."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import threading
import traceback
import uuid
from collections.abc import Callable, Mapping
from datetime import UTC
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from sse_starlette.sse import EventSourceResponse
from starlette.requests import ClientDisconnect

from variant_maker.farm.drive import DriveClient, is_video_file
from variant_maker.farm.ledger import Ledger

from .auth_app import PUBLIC_API_PATHS, AttrProxy, JobStoreProxy, current_bundle, tenant_cv
from .caption_ai import parse_caption_prompts_field
from .captions import CaptionError, CaptionStore, split_caption_bank, strip_internal_index_lines
from .destinations import Destination, DestinationError, DestinationStore, probe_folder_writable
from .drive_config import (
    ENV_OAUTH_CLIENT_ID,
    ENV_OAUTH_CLIENT_SECRET,
    ENV_OAUTH_REDIRECT_URI,
    read_share_email,
    resolve_drive_status,
)
from .drive_exports import (
    ExportError,
    ExportJob,
    ExportRunner,
    ExportStore,
    VariantRef,
    build_export_files,
)
from .drive_oauth import (
    ENV_LOGIN_REDIRECT_URI,
    LOGIN_SCOPES,
    OAuthPendingStore,
    OAuthTokenStore,
    build_authorization_url,
    exchange_code_for_token,
    fetch_connected_email,
    new_oauth_state,
    public_request_base,
    resolve_login_profile,
    resolve_login_redirect_uri,
    resolve_redirect_uri,
    studio_origin_from_redirect_uri,
)
from .drive_split import execute_split_export
from .drive_urls import DriveUrlError, parse_folder_id
from .drop_ledger import (
    ensure_ledger,
    list_job_ids_on_disk,
    load_manifest_rows,
    persist_platform_result,
    resolve_sheet_id,
    spreadsheet_url,
    sync_rows,
    update_post_url_cell,
    write_sheet_id_file,
)
from .drops import DropPack, build_drop_packs
from .events import VariantEvent, event_to_dict
from .experience import resolve_experience
from .jobs import (
    Job,
    JobSource,
    JobStore,
    source_copy_status,
    source_files_ready,
    variant_on_disk,
)
from .models import (
    AdminMemberOut,
    AdminViewIn,
    AdminWorkspaceOut,
    AuthMeOut,
    CaptionAdvanceIn,
    CaptionBankFolderOut,
    CaptionBankOut,
    CaptionBulkIn,
    CaptionCreateIn,
    CaptionFolderCreateIn,
    CaptionIn,
    CaptionOut,
    CaptionPreviewOut,
    CaptionRewriteIn,
    CreateJobResponse,
    DestinationCreateIn,
    DestinationOut,
    DestinationUpdateIn,
    DiagnosticsItem,
    DriveStatusOut,
    DriveVideoOut,
    DriveVideosOut,
    DropFileOut,
    DropLedgerEnsureOut,
    DropLedgerStatusOut,
    DropLedgerSyncIn,
    DropLedgerSyncOut,
    DropPackOut,
    ExportCreateIn,
    ExportFileOut,
    ExportJobOut,
    ExportSplitIn,
    InFlightOut,
    InviteCreateIn,
    InviteOut,
    JobDetail,
    JobEventsSnapshot,
    JobFromDriveIn,
    JobSummary,
    LookPreviewOut,
    PasswordLoginIn,
    PasswordSetIn,
    PlatformResultIn,
    PostUrlIn,
    QueueOut,
    SourceOut,
    SplitExportOut,
    TeamOut,
    VariantOut,
    WorkflowCreateIn,
    WorkflowOut,
    WorkflowSummaryOut,
    WorkflowUpdateIn,
    WorkspaceExperienceIn,
    WorkspaceInviteIn,
)
from .passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
from .post_url import normalize_post_url
from .runner import LocalRunner
from .sessions import (
    COOKIE_NAME,
    DEFAULT_TTL_S,
    VIEW_COOKIE_NAME,
    load_or_create_secret,
    read_session,
    read_view,
    sign_session,
    sign_view,
)
from .sheets import GoogleSheets, SheetsClient
from .tenant_runtime import TenantHub
from .tenants import (
    TenantStore,
    combined_admin_emails,
    is_admin_email,
    normalize_email,
    provision_login,
)
from .tenants import (
    auth_required as tenant_auth_required,
)
from .workflow_runner import cancel_workflow_jobs, tick_workflow
from .workflows import Workflow, WorkflowError, WorkflowStore
from .workspace import Workspace

_IN_FLIGHT_STATES = frozenset({"rendering", "checking", "looking", "rerolling", "uniqueness", "escalating"})
_UPLOAD_META: dict[str, dict] = {}

ExchangeFn = Callable[..., dict[str, Any]]
FetchEmailFn = Callable[[dict[str, Any]], str | None]


def _look_file_url(source_id: str, name: str | None) -> str | None:
    if not name:
        return None
    return f"/api/look/{source_id}/{quote(name, safe='')}"


def _variant_out(source_id: str, v, *, file_ready: bool = True) -> VariantOut:
    return VariantOut(
        index=v.index, filename=v.filename, status=v.status, quality=v.quality,
        file_url=f"/api/variants/{source_id}/{quote(v.filename, safe='')}",
        uniqueness=v.uniqueness, uniqueness_status=v.uniqueness_status,
        uniqueness_metric=v.uniqueness_metric, uniqueness_target=v.uniqueness_target,
        preset_used=v.preset_used, strength_final=v.strength_final,
        escalated=v.escalated, platform_result=v.platform_result,
        post_url=v.post_url,
        file_ready=file_ready,
        look_status=v.look_status,
        look_mae=v.look_mae,
        look_src_url=_look_file_url(source_id, v.look_src),
        look_var_url=_look_file_url(source_id, v.look_var),
        caption=strip_internal_index_lines(getattr(v, "caption", None) or "") or None,
    )


def _in_flights(job: Job | None, source_id: str) -> list[InFlightOut]:
    """Latest live state per variant index. Fast runs several copies at once."""
    if job is None or job.state in ("done", "cancelled"):
        return []
    latest: dict[int, VariantEvent] = {}
    for e in job.events:
        if e.source_id != source_id:
            continue
        latest[e.index] = e
    out: list[InFlightOut] = []
    for idx in sorted(latest):
        e = latest[idx]
        if e.state in _IN_FLIGHT_STATES:
            out.append(InFlightOut(
                index=e.index, state=e.state, attempt=e.attempt, max_attempts=e.max_attempts,
            ))
    return out


def _in_flight(job: Job | None, source_id: str) -> InFlightOut | None:
    """Newest live copy (Gallery 'still running'). Prefer ``_in_flights`` for Studio.

    Walk newest-first and skip finished indexes — a done v01 must not hide v02–v08.
    """
    if job is None or job.state in ("done", "cancelled"):
        return None
    for e in reversed(job.events):
        if e.source_id != source_id:
            continue
        if e.state in _IN_FLIGHT_STATES:
            return InFlightOut(
                index=e.index, state=e.state, attempt=e.attempt, max_attempts=e.max_attempts,
            )
    return None


def _look_preview(job: Job | None, source_id: str) -> LookPreviewOut | None:
    if job is None:
        return None
    for e in reversed(job.events):
        if e.source_id != source_id:
            continue
        if e.state == "looking" and (e.look_src or e.look_var):
            return LookPreviewOut(
                index=e.index,
                look_status=e.look_status,
                look_mae=e.look_mae,
                look_src_url=_look_file_url(source_id, e.look_src),
                look_var_url=_look_file_url(source_id, e.look_var),
            )
    return None


def _source_out(s: JobSource, *, ok_only: bool, job: Job | None = None,
                ws: Workspace | None = None) -> SourceOut:
    variants = [v for v in s.variants if (v.status == "ok" or not ok_only)]
    failed = sum(1 for v in s.variants if v.status in ("best_effort", "corrupt", "uniqueness_fail"))
    job_id = job.job_id if job is not None else None
    files_ready = (
        source_files_ready(s, ws, job_id) if ws is not None and job_id else s.delivered
    )
    copy_status = (
        source_copy_status(s, ws, job_id, job.state if job is not None else None)
        if ws is not None and job_id else "ok"
    )
    return SourceOut(
        source_id=s.source_id, filename=s.filename, requested=s.requested,
        delivered=s.delivered, shortfall=s.shortfall,
        variants=[
            _variant_out(
                s.source_id, v,
                file_ready=(
                    variant_on_disk(ws, job_id, s.source_id, v.filename)
                    if ws is not None and job_id else True
                ),
            )
            for v in variants
        ],
        in_flight=_in_flight(job, s.source_id),
        in_flights=_in_flights(job, s.source_id),
        look_preview=_look_preview(job, s.source_id),
        job_state=job.state if job is not None else None,
        failed=failed,
        created_utc=job.created_utc if job is not None else None,
        files_ready=files_ready,
        copy_status=copy_status,
        job_id=job_id,
        caption_prompt=(s.caption_prompt or None),
    )


def _destination_out(d: Destination) -> DestinationOut:
    return DestinationOut(id=d.id, name=d.name, folder_id=d.folder_id, auth_mode=d.auth_mode)


def _workflow_summary_out(raw: dict | None) -> WorkflowSummaryOut | None:
    if not raw:
        return None
    return WorkflowSummaryOut(
        queued=int(raw.get("queued") or 0),
        exported=int(raw.get("exported") or 0),
        skipped=int(raw.get("skipped") or 0),
        failed=int(raw.get("failed") or 0),
        running=int(raw.get("running") or 0),
        job_ids=list(raw.get("job_ids") or []),
        error=raw.get("error"),
    )


def _workflow_out(w: Workflow) -> WorkflowOut:
    return WorkflowOut(
        id=w.id,
        name=w.name,
        inbox_destination_id=w.inbox_destination_id,
        output_destination_id=w.output_destination_id,
        count=w.count,
        quality_mode=w.quality_mode,
        allow_creative_escalate=w.allow_creative_escalate,
        enabled=w.enabled,
        poll_seconds=w.poll_seconds,
        last_sweep_at=w.last_sweep_at,
        last_summary=_workflow_summary_out(w.last_summary),
        auto_caption=w.auto_caption,
        caption_bank_id=w.caption_bank_id or None,
        caption_from_filename=bool(w.caption_from_filename),
    )


def _caption_bank_payload(store: CaptionStore, bank_id: str | None = None) -> CaptionBankOut:
    meta = store.bank_meta(bank_id)
    return CaptionBankOut(
        cursor=meta.cursor,
        items=[CaptionOut(id=c.id, text=c.text) for c in store.list(meta.id)],
        bank_id=meta.id,
        bank_name=meta.name,
        count=meta.count,
        remaining=meta.remaining,
        low=meta.low,
        is_default=meta.is_default,
    )


def _caption_folder_out(meta) -> CaptionBankFolderOut:
    return CaptionBankFolderOut(
        id=meta.id,
        name=meta.name,
        is_default=meta.is_default,
        count=meta.count,
        remaining=meta.remaining,
        cursor=meta.cursor,
        low=meta.low,
    )



def _export_job_out(job: ExportJob) -> ExportJobOut:
    return ExportJobOut(
        export_id=job.export_id, destination_id=job.destination_id, folder_id=job.folder_id,
        state=job.state, created_utc=job.created_utc,
        files=[ExportFileOut(source_id=f.source_id, index=f.index, filename=f.filename,
                             status=f.status, error=f.error, drive_file_id=f.drive_file_id)
               for f in job.files],
    )


def _drop_pack_out(pack: DropPack) -> DropPackOut:
    return DropPackOut(
        export_id=pack.export_id,
        created_utc=pack.created_utc,
        destination_id=pack.destination_id,
        destination_name=pack.destination_name,
        folder_id=pack.folder_id,
        count=pack.count,
        outcome=pack.outcome,
        miss_labels=list(pack.miss_labels),
        files=[
            DropFileOut(
                source_id=f.source_id, index=f.index, variant_id=f.variant_id,
                job_id=f.job_id, drive_file_id=f.drive_file_id,
                platform_result=f.platform_result, outcome=f.outcome,
            )
            for f in pack.files
        ],
    )


def _drive_status_out(info) -> DriveStatusOut:
    return DriveStatusOut(
        status=info.status,
        sa_email=info.sa_email,
        message=info.message,
        auth_mode=info.auth_mode,
        connected_email=info.connected_email,
        oauth_available=info.oauth_available,
        share_email=read_share_email(),
    )


def _build_drive_client(*, sa_json_path: str | None = None,
                        oauth_token_path: str | None = None) -> DriveClient:
    from variant_maker.farm.drive import GoogleDrive
    if oauth_token_path:
        return GoogleDrive(oauth_token=oauth_token_path)
    if sa_json_path:
        return GoogleDrive(service_account_json=sa_json_path)
    raise ValueError("need sa_json_path or oauth_token_path")


def _resolve_folder_id(folder_url: str) -> str:
    """`parse_folder_id`'s bare-id heuristic requires 10+ chars (real Drive ids are
    long); fall back to treating any non-URL, non-file-link token as a literal id and
    let the write-probe be the real check, so short test-double ids still resolve."""
    s = (folder_url or "").strip()
    try:
        return parse_folder_id(s)
    except DriveUrlError:
        if s and "://" not in s and "/" not in s:
            return s
        raise


def create_app(
    store: JobStore | None = None,
    *,
    drive: DriveClient | None = None,
    sheets: SheetsClient | None = None,
    sa_json_path: str | None = None,
    oauth_token_path: str | None = None,
    oauth_environ: Mapping[str, str] | None = None,
    oauth_exchange: ExchangeFn | None = None,
    oauth_fetch_email: FetchEmailFn | None = None,
    hydrate: bool = True,
    enable_workflow_poller: bool = False,
    auth_environ: Mapping[str, str] | None = None,
    login_exchange: ExchangeFn | None = None,
) -> FastAPI:
    if store is None:
        store = JobStore(Workspace("./.vmdata"), LocalRunner())
    fallback_store = store
    oauth_env: Mapping[str, str] = oauth_environ if oauth_environ is not None else os.environ
    auth_env: Mapping[str, str] = auth_environ if auth_environ is not None else os.environ
    auth_on = tenant_auth_required(auth_env)
    admin_email = combined_admin_emails(auth_env) or None
    data_dir = fallback_store._ws.root

    app = FastAPI(title="variant-maker control plane")
    tenants: TenantStore | None = None
    hub: TenantHub | None = None
    auth_secret = ""
    login_pending: OAuthPendingStore | None = None
    if auth_on:
        auth_dir = os.path.join(data_dir, "auth")
        os.makedirs(auth_dir, exist_ok=True)
        tenants = TenantStore(os.path.join(auth_dir, "tenants.json"))
        hub = TenantHub(
            data_dir, fallback_store._runner,
            object_store=getattr(fallback_store, "_object_store", None),
            gallery_keep_jobs=getattr(fallback_store, "_keep", None),
            gallery_keep_hours=getattr(fallback_store, "_keep_hours", None),
        )
        auth_secret = load_or_create_secret(
            os.path.join(auth_dir, "secret"),
            environ=auth_env if auth_environ is not None else None,
        )
        login_pending = OAuthPendingStore(os.path.join(auth_dir, "login_pending.json"))
        if hydrate:
            hub.hydrate_all(tenants.list_workspace_ids())
    elif hydrate:
        fallback_store.hydrate_from_disk()

    store = JobStoreProxy(fallback_store)
    app.state.store = store
    app.state.tenants = tenants
    app.state.tenant_hub = hub
    app.state.auth_required = auth_on

    if oauth_token_path is None:
        oauth_token_path = fallback_store._ws.oauth_token_path()
    token_store = OAuthTokenStore(oauth_token_path)
    pending_store = OAuthPendingStore(fallback_store._ws.oauth_pending_path())
    app.state.oauth_token_store = token_store
    app.state.oauth_pending = pending_store
    app.state.oauth_environ = oauth_env
    app.state.oauth_exchange = oauth_exchange or exchange_code_for_token
    app.state.oauth_fetch_email = oauth_fetch_email or fetch_connected_email
    app.state.login_exchange = login_exchange

    # Explicit "" means "no SA" (tests); None means fall through to env.
    sa_arg = None if sa_json_path in (None, "") else sa_json_path
    drive_info = resolve_drive_status(
        sa_arg,
        oauth_token_path=oauth_token_path,
        environ=oauth_env if oauth_environ is not None else None,
    )
    if sa_json_path == "":
        drive_info = resolve_drive_status(
            None, oauth_token_path=oauth_token_path, environ=oauth_env,
        )

    if drive is None and drive_info.status == "ready":
        if drive_info.auth_mode == "oauth":
            drive = _build_drive_client(oauth_token_path=oauth_token_path)
        elif sa_arg:
            drive = _build_drive_client(sa_json_path=sa_arg)
        else:
            from .drive_config import ENV_SA_JSON
            env_sa = oauth_env.get(ENV_SA_JSON) if oauth_environ is not None else os.environ.get(ENV_SA_JSON)
            if env_sa:
                drive = _build_drive_client(sa_json_path=env_sa)

    if sheets is None and drive_info.status == "ready" and drive_info.auth_mode == "oauth":
        try:
            sheets = GoogleSheets(oauth_token=oauth_token_path)
        except Exception:
            sheets = None

    app.state.drive = drive
    app.state.sheets = sheets
    app.state.drive_info = drive_info
    app.state.destinations = AttrProxy(
        "destinations", DestinationStore(fallback_store._ws.destinations_path()),
    )
    app.state.exports = AttrProxy("exports", ExportStore(fallback_store._ws.exports_dir()))
    app.state.workflows = AttrProxy(
        "workflows", WorkflowStore(fallback_store._ws.workflows_path()),
    )
    app.state.captions = AttrProxy("captions", CaptionStore(fallback_store._ws.captions_path()))
    app.state.workflow_tick_lock = threading.Lock()

    def _oauth_tokens() -> OAuthTokenStore:
        bundle = current_bundle()
        if bundle is not None:
            return bundle.oauth_token_store
        return token_store

    def _oauth_pending() -> OAuthPendingStore:
        bundle = current_bundle()
        if bundle is not None:
            return bundle.oauth_pending
        return pending_store

    def _token_path() -> str:
        return _oauth_tokens().path

    def _compute_drive_info():
        path = _token_path()
        if sa_json_path == "":
            return resolve_drive_status(None, oauth_token_path=path, environ=oauth_env)
        return resolve_drive_status(
            None if sa_json_path in (None, "") else sa_json_path,
            oauth_token_path=path,
            environ=oauth_env,
        )

    def _refresh_drive_info() -> None:
        info = _compute_drive_info()
        if current_bundle() is None:
            app.state.drive_info = info

    def _drive_info():
        if current_bundle() is None:
            return app.state.drive_info
        return _compute_drive_info()

    def _attach_oauth_clients() -> tuple[DriveClient | None, SheetsClient | None]:
        path = _token_path()
        client = None
        sheets_client = None
        try:
            client = _build_drive_client(oauth_token_path=path)
        except Exception:  # noqa: BLE001 — token file may be incomplete
            client = None
        try:
            sheets_client = GoogleSheets(oauth_token=path)
        except Exception:  # noqa: BLE001 — sheets optional
            sheets_client = None
        return client, sheets_client

    def _drive() -> DriveClient | None:
        bundle = current_bundle()
        if bundle is None:
            return app.state.drive
        if bundle.drive is not None:
            return bundle.drive
        info = _compute_drive_info()
        if info.status == "ready" and info.auth_mode == "oauth":
            bundle.drive, bundle.sheets = _attach_oauth_clients()
        elif info.status == "ready" and info.auth_mode == "service_account" and sa_arg:
            try:
                bundle.drive = _build_drive_client(sa_json_path=sa_arg)
            except Exception:  # noqa: BLE001 — SA json may be unreadable
                bundle.drive = None
        return bundle.drive

    def _sheets() -> SheetsClient | None:
        bundle = current_bundle()
        if bundle is None:
            return app.state.sheets
        if bundle.sheets is not None:
            return bundle.sheets
        info = _compute_drive_info()
        if info.status == "ready" and info.auth_mode == "oauth":
            _, bundle.sheets = _attach_oauth_clients()
        return bundle.sheets

    def _set_drive(client: DriveClient | None) -> None:
        bundle = current_bundle()
        if bundle is not None:
            bundle.drive = client
        else:
            app.state.drive = client

    def _set_sheets(client: SheetsClient | None) -> None:
        bundle = current_bundle()
        if bundle is not None:
            bundle.sheets = client
        else:
            app.state.sheets = client

    def _account_email() -> str | None:
        info = _drive_info()
        return read_share_email() or info.connected_email or info.sa_email

    def _require_drive() -> None:
        info = _drive_info()
        if _drive() is None or info.status != "ready":
            raise HTTPException(status_code=503, detail=info.message)

    def _require_sheets() -> SheetsClient:
        sheets_client = _sheets()
        if sheets_client is None:
            raise HTTPException(
                status_code=503,
                detail="Sheets not available — Connect Google in Settings → Drive "
                       "(must grant Spreadsheets scope)",
            )
        return sheets_client

    def _drop_sheet_path() -> str:
        return store._ws.drop_sheet_config_path()

    def _current_sheet_id() -> str | None:
        return resolve_sheet_id(oauth_env, _drop_sheet_path())

    def _persist_sheet_id(sid: str) -> None:
        write_sheet_id_file(_drop_sheet_path(), sid)

    def _cookie_kw(request: Request) -> dict[str, Any]:
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        secure = str(proto).split(",")[0].strip() == "https"
        return {
            "httponly": True,
            "samesite": "lax",
            "path": "/",
            "max_age": DEFAULT_TTL_S,
            "secure": secure,
        }

    def _oauth_client_pair() -> tuple[str, str]:
        cid = str(oauth_env.get(ENV_OAUTH_CLIENT_ID) or auth_env.get(ENV_OAUTH_CLIENT_ID) or "")
        csec = str(oauth_env.get(ENV_OAUTH_CLIENT_SECRET) or auth_env.get(ENV_OAUTH_CLIENT_SECRET) or "")
        return cid, csec

    def _login_redirect_uri(request: Request) -> str:
        explicit = auth_env.get(ENV_LOGIN_REDIRECT_URI)
        fallback = str(request.base_url).rstrip("/")
        base = public_request_base(request.headers, fallback)
        return resolve_login_redirect_uri(auth_env, request_base=base, explicit=explicit)

    def _login_origin(request: Request) -> str:
        fallback = str(request.base_url).rstrip("/")
        return studio_origin_from_redirect_uri(
            _login_redirect_uri(request),
            public_request_base(request.headers, fallback),
        )

    def _require_user(request: Request):
        user = getattr(request.state, "user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="login required")
        return user

    def _require_admin(request: Request):
        user = _require_user(request)
        if not is_admin_email(user.email, admin_email):
            raise HTTPException(status_code=403, detail="admin only")
        return user

    def _require_workspace_owner(request: Request):
        user = _require_user(request)
        if user.role != "owner" and not is_admin_email(user.email, admin_email):
            raise HTTPException(status_code=403, detail="owner only")
        return user

    def _require_agency_team(request: Request):
        """Agency owners invite VAs. Solo creators cannot — they only get Studio/Gallery/Drive."""
        user = _require_workspace_owner(request)
        assert tenants is not None
        ws = tenants.get_workspace(user.workspace_id)
        exp = resolve_experience(
            workspace_experience=getattr(ws, "experience", None) if ws else None,
            email=user.email,
        )
        if exp != "agency" and not is_admin_email(user.email, admin_email):
            raise HTTPException(status_code=403, detail="solo creators cannot invite")
        return user

    def _team_out(home_id: str) -> TeamOut:
        assert tenants is not None
        ws = tenants.get_workspace(home_id)
        users = [u for u in tenants.list_users() if u.workspace_id == home_id]
        members = sorted(users, key=lambda u: (0 if u.role == "owner" else 1, u.email))
        invites = [i for i in tenants.list_invites() if i.workspace_id == home_id]
        return TeamOut(
            workspace_id=home_id,
            workspace_name=ws.name if ws else None,
            members=[
                AdminMemberOut(email=u.email, name=u.name, role=u.role)
                for u in members
            ],
            invites=[
                InviteOut(
                    id=i.id, email=i.email, kind=i.kind,
                    workspace_id=i.workspace_id, created_utc=i.created_utc,
                )
                for i in invites
            ],
        )

    def _admin_workspace_out(ws) -> AdminWorkspaceOut:
        assert tenants is not None and hub is not None
        users = [u for u in tenants.list_users() if u.workspace_id == ws.id]
        owner = next((u.email for u in users if u.role == "owner"), None)
        if owner is None and users:
            owner = users[0].email
        bundle = hub.bundle(ws.id)
        q = bundle.store.queue()
        ordered = sorted(bundle.store.list(), key=lambda j: j.created_utc or "", reverse=True)
        last_job_utc = ordered[0].created_utc if ordered else None
        last_error = next((j.error for j in ordered if j.error), None)
        members = sorted(users, key=lambda u: (0 if u.role == "owner" else 1, u.email))
        return AdminWorkspaceOut(
            id=ws.id,
            name=ws.name,
            owner_email=owner,
            member_count=len(users),
            members=[
                AdminMemberOut(email=u.email, name=u.name, role=u.role)
                for u in members
            ],
            running=int(q.get("running") or 0),
            fast=int(q.get("fast") or 0),
            hq=int(q.get("hq") or 0),
            last_job_utc=last_job_utc,
            last_error=last_error,
            experience=getattr(ws, "experience", None) or "agency",
        )

    def _default_login_exchange(
        *, code: str, client_id: str, client_secret: str, redirect_uri: str, **_kwargs: Any,
    ) -> dict[str, Any]:
        token_data = exchange_code_for_token(
            code=code, client_id=client_id, client_secret=client_secret,
            redirect_uri=redirect_uri, scopes=LOGIN_SCOPES,
        )
        email, name = resolve_login_profile(token_data)
        return {"email": email, "name": name, **token_data}

    def _sync_platform_result_to_sheet(source_id: str, index: int, result: str) -> None:
        sheets_client = _sheets()
        sid = _current_sheet_id()
        if sheets_client is None or not sid:
            return
        loc = store._locate(source_id)
        if loc is None:
            return
        job_id, _ = loc
        try:
            persist_platform_result(
                sheets_client, sid,
                job_id=job_id, source_id=source_id, index=index, result=result,
                rows=load_manifest_rows(store._ws.root, job_id),
            )
        except Exception as exc:
            print(f"drop ledger platform_result write failed: {exc}", flush=True)

    def _sync_post_url_to_sheet(source_id: str, index: int, url: str | None) -> None:
        sheets_client = _sheets()
        sid = _current_sheet_id()
        if sheets_client is None or not sid:
            return
        loc = store._locate(source_id)
        if loc is None:
            return
        job_id, _ = loc
        try:
            update_post_url_cell(
                sheets_client, sid,
                job_id=job_id, source_id=source_id, index=index, url=url or "",
            )
        except Exception as exc:
            print(f"drop ledger post_url write failed: {exc}", flush=True)

    def _redirect_uri_for(request: Request) -> str:
        explicit = oauth_env.get(ENV_OAUTH_REDIRECT_URI)
        fallback = str(request.base_url).rstrip("/")
        base = public_request_base(request.headers, fallback)
        return resolve_redirect_uri(oauth_env, request_base=base, explicit=explicit)

    def _settings_url(request: Request, query: str) -> str:
        fallback = str(request.base_url).rstrip("/")
        origin = studio_origin_from_redirect_uri(
            _redirect_uri_for(request),
            public_request_base(request.headers, fallback),
        )
        return f"{origin}/settings/drive?{query}"

    def _run_workflow_tick(wf: Workflow) -> Workflow:
        from datetime import datetime
        ts = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        inbox = app.state.destinations.get(wf.inbox_destination_id)
        output = app.state.destinations.get(wf.output_destination_id)
        if inbox is None or output is None:
            summary = {
                "queued": 0, "exported": 0, "skipped": 0, "failed": 0,
                "running": 0, "job_ids": [], "error": "destination missing",
            }
            return app.state.workflows.update(
                wf.id, last_sweep_at=ts, last_summary=summary, touch_sweep=True,
            ) or wf
        drive_client = _drive()
        info = _drive_info()
        if drive_client is None or info.status != "ready":
            summary = {
                "queued": 0, "exported": 0, "skipped": 0, "failed": 0,
                "running": 0, "job_ids": [],
                "error": info.message,
            }
            return app.state.workflows.update(
                wf.id, last_sweep_at=ts, last_summary=summary, touch_sweep=True,
            ) or wf
        ledger = Ledger(store._ws.workflow_ledger_path(wf.id))
        with app.state.workflow_tick_lock:
            result = tick_workflow(
                wf,
                drive=drive_client,
                inbox_folder_id=inbox.folder_id,
                output_folder_id=output.folder_id,
                job_store=store,
                ledger=ledger,
                work_dir=store._ws.workflow_work_dir(),
                caption_store=app.state.captions,
            )
        return app.state.workflows.update(
            wf.id, last_sweep_at=ts, last_summary=result.as_dict(), touch_sweep=True,
        ) or wf

    @app.middleware("http")
    async def tenant_middleware(request: Request, call_next):
        token = tenant_cv.set(None)
        try:
            if not auth_on or tenants is None or hub is None:
                return await call_next(request)
            path = request.url.path
            sess = read_session(request.cookies.get(COOKIE_NAME), auth_secret)
            user = tenants.get_user(sess["email"]) if sess else None
            if user is None or not user.workspace_id:
                user = None
            protected = path.startswith("/api/") and path not in PUBLIC_API_PATHS
            if protected and user is None:
                return JSONResponse({"detail": "login required"}, status_code=401)
            if user is not None:
                viewing_id = user.workspace_id
                if is_admin_email(user.email, admin_email):
                    view = read_view(request.cookies.get(VIEW_COOKIE_NAME), auth_secret)
                    if view and tenants.get_workspace(view) is not None:
                        viewing_id = view
                tenant_cv.set(hub.bundle(viewing_id))
                request.state.user = user
                request.state.viewing_workspace_id = viewing_id
            else:
                request.state.user = None
                request.state.viewing_workspace_id = None
            return await call_next(request)
        finally:
            tenant_cv.reset(token)

    @app.get("/api/health")
    def health() -> dict:
        raw = (os.environ.get("VARIANT_LAB") or "").strip().lower()
        return {"status": "ok", "lab": raw in {"1", "true", "yes"}}

    def _auth_me_out(user, viewing_id: str | None = None) -> AuthMeOut:
        assert tenants is not None
        viewing_id = viewing_id or user.workspace_id
        ws = tenants.get_workspace(viewing_id) or tenants.get_workspace(user.workspace_id)
        fresh = tenants.get_user(user.email) or user
        return AuthMeOut(
            auth_required=True,
            email=user.email,
            name=user.name,
            workspace_id=viewing_id,
            workspace_name=ws.name if ws else None,
            home_workspace_id=user.workspace_id,
            viewing_other=viewing_id != user.workspace_id,
            role=user.role,
            is_admin=is_admin_email(user.email, admin_email),
            has_password=bool(fresh.password_hash),
            experience=resolve_experience(
                workspace_experience=getattr(ws, "experience", None) if ws else None,
                email=user.email,
            ),
        )

    def _set_session_cookie(response: Response, request: Request, user) -> None:
        token = sign_session(
            email=user.email, workspace_id=user.workspace_id, secret=auth_secret,
        )
        response.set_cookie(COOKIE_NAME, token, **_cookie_kw(request))

    @app.get("/api/auth/me", response_model=AuthMeOut)
    def auth_me(request: Request) -> AuthMeOut:
        if not auth_on or tenants is None:
            return AuthMeOut(auth_required=False)
        user = getattr(request.state, "user", None)
        if user is None:
            return AuthMeOut(auth_required=True)
        viewing_id = getattr(request.state, "viewing_workspace_id", None) or user.workspace_id
        return _auth_me_out(user, viewing_id)

    @app.post("/api/auth/password", response_model=AuthMeOut)
    def auth_password(request: Request, body: PasswordLoginIn, response: Response) -> AuthMeOut:
        if not auth_on or tenants is None:
            raise HTTPException(status_code=404, detail="auth is off")
        email = normalize_email(body.email)
        password = body.password or ""
        if not email:
            raise HTTPException(status_code=400, detail="email is required")
        if len(password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            )
        existing = tenants.get_user(email)
        if existing is not None and existing.password_hash:
            if not verify_password(password, existing.password_hash):
                raise HTTPException(status_code=401, detail="Email or password is wrong.")
            user = existing
        else:
            if existing is not None and not existing.password_hash:
                raise HTTPException(
                    status_code=400,
                    detail="This account signs in with Google. Use Continue with Google, "
                           "then add a password under Drive.",
                )
            user = provision_login(
                tenants,
                email=email,
                name=email.split("@")[0] or email,
                admin_email=admin_email,
                data_dir=data_dir,
            )
            if user is None:
                raise HTTPException(
                    status_code=401,
                    detail="This email isn't invited. Ask the operator to add you.",
                )
            tenants.set_password(user.email, hash_password(password))
            user = tenants.get_user(user.email) or user
        _set_session_cookie(response, request, user)
        return _auth_me_out(user)

    @app.post("/api/auth/password/set", status_code=204)
    def auth_password_set(request: Request, body: PasswordSetIn) -> Response:
        if not auth_on or tenants is None:
            raise HTTPException(status_code=404, detail="auth is off")
        user = getattr(request.state, "user", None)
        if user is None:
            raise HTTPException(status_code=401, detail="login required")
        password = body.password or ""
        if len(password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            )
        tenants.set_password(user.email, hash_password(password))
        return Response(status_code=204)

    @app.post("/api/auth/logout", status_code=204)
    def auth_logout() -> Response:
        resp = Response(status_code=204)
        resp.delete_cookie(COOKIE_NAME, path="/")
        resp.delete_cookie(VIEW_COOKIE_NAME, path="/")
        return resp

    @app.get("/api/auth/google/start")
    def auth_google_start(request: Request):
        if not auth_on or login_pending is None:
            raise HTTPException(status_code=404, detail="auth is off")
        client_id, _client_secret = _oauth_client_pair()
        if not client_id:
            raise HTTPException(
                status_code=503,
                detail="OAuth not configured — set VARIANT_DRIVE_OAUTH_CLIENT_ID and "
                       "VARIANT_DRIVE_OAUTH_CLIENT_SECRET",
            )
        state = new_oauth_state()
        login_pending.add(state)
        redirect_uri = _login_redirect_uri(request)
        url = build_authorization_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state,
            scopes=LOGIN_SCOPES,
        )
        return RedirectResponse(url=url, status_code=302)

    @app.get("/api/auth/google/callback")
    def auth_google_callback(
        request: Request,
        code: str | None = None,
        state: str | None = None,
        error: str | None = None,
    ):
        if not auth_on or tenants is None or login_pending is None:
            raise HTTPException(status_code=404, detail="auth is off")
        origin = _login_origin(request)

        def fail(reason: str) -> RedirectResponse:
            return RedirectResponse(url=f"{origin}/login?error={reason}", status_code=302)

        if error or not code or not state or not login_pending.consume(state):
            return fail("oauth")
        client_id, client_secret = _oauth_client_pair()
        redirect_uri = _login_redirect_uri(request)
        exch = login_exchange or _default_login_exchange
        try:
            profile = exch(
                code=code, client_id=client_id, client_secret=client_secret,
                redirect_uri=redirect_uri,
            )
            email = str((profile or {}).get("email") or "")
            name = str((profile or {}).get("name") or "")
        except Exception as exc:  # noqa: BLE001 — Google token exchange is opaque
            print(f"login exchange failed: {exc}", flush=True)
            traceback.print_exc()
            return fail("oauth")
        if not email:
            return fail("oauth")
        user = provision_login(
            tenants, email=email, name=name, admin_email=admin_email, data_dir=data_dir,
        )
        if user is None:
            return fail("not_invited")
        resp = RedirectResponse(url=f"{origin}/", status_code=302)
        _set_session_cookie(resp, request, user)
        return resp

    @app.get("/api/auth/invites", response_model=list[InviteOut])
    def list_invites(request: Request) -> list[InviteOut]:
        _require_admin(request)
        assert tenants is not None
        return [
            InviteOut(
                id=i.id, email=i.email, kind=i.kind,
                workspace_id=i.workspace_id, created_utc=i.created_utc,
            )
            for i in tenants.list_invites()
        ]

    @app.post("/api/auth/invites", status_code=201, response_model=InviteOut)
    def create_invite(request: Request, body: InviteCreateIn) -> InviteOut:
        admin = _require_admin(request)
        assert tenants is not None
        ws_id = admin.workspace_id if body.kind == "join" else None
        try:
            inv = tenants.add_invite(email=body.email, kind=body.kind, workspace_id=ws_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return InviteOut(
            id=inv.id, email=inv.email, kind=inv.kind,
            workspace_id=inv.workspace_id, created_utc=inv.created_utc,
        )

    @app.delete("/api/auth/invites/{invite_id}", status_code=204)
    def delete_invite(request: Request, invite_id: str) -> None:
        _require_admin(request)
        assert tenants is not None
        if not tenants.delete_invite(invite_id):
            raise HTTPException(status_code=404, detail="invite not found")

    @app.get("/api/admin/workspaces", response_model=list[AdminWorkspaceOut])
    def admin_workspaces(request: Request) -> list[AdminWorkspaceOut]:
        _require_admin(request)
        assert tenants is not None
        return [_admin_workspace_out(ws) for ws in tenants.list_workspaces()]

    @app.patch("/api/admin/workspaces/{workspace_id}", response_model=AdminWorkspaceOut)
    def admin_patch_workspace(
        request: Request, workspace_id: str, body: WorkspaceExperienceIn,
    ) -> AdminWorkspaceOut:
        _require_admin(request)
        assert tenants is not None
        ws = tenants.set_workspace_experience(workspace_id, body.experience)
        if ws is None:
            raise HTTPException(status_code=404, detail="workspace not found")
        return _admin_workspace_out(ws)

    @app.delete("/api/admin/users/{email}", status_code=204)
    def admin_delete_user(request: Request, email: str) -> None:
        _require_admin(request)
        assert tenants is not None
        addr = normalize_email(email)
        if is_admin_email(addr, admin_email):
            raise HTTPException(status_code=400, detail="cannot remove the admin account")
        if not tenants.delete_user(addr):
            raise HTTPException(status_code=404, detail="user not found")

    @app.get("/api/workspace/team", response_model=TeamOut)
    def workspace_team(request: Request) -> TeamOut:
        owner = _require_agency_team(request)
        return _team_out(owner.workspace_id)

    @app.post("/api/workspace/invites", status_code=201, response_model=InviteOut)
    def workspace_create_invite(request: Request, body: WorkspaceInviteIn) -> InviteOut:
        owner = _require_agency_team(request)
        assert tenants is not None
        try:
            inv = tenants.add_invite(
                email=body.email, kind="join", workspace_id=owner.workspace_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return InviteOut(
            id=inv.id, email=inv.email, kind=inv.kind,
            workspace_id=inv.workspace_id, created_utc=inv.created_utc,
        )

    @app.delete("/api/workspace/invites/{invite_id}", status_code=204)
    def workspace_delete_invite(request: Request, invite_id: str) -> None:
        owner = _require_agency_team(request)
        assert tenants is not None
        inv = next((i for i in tenants.list_invites() if i.id == invite_id), None)
        if inv is None or inv.workspace_id != owner.workspace_id:
            raise HTTPException(status_code=404, detail="invite not found")
        tenants.delete_invite(invite_id)

    @app.delete("/api/workspace/members/{email}", status_code=204)
    def workspace_remove_member(request: Request, email: str) -> None:
        owner = _require_agency_team(request)
        assert tenants is not None
        addr = normalize_email(email)
        if addr == normalize_email(owner.email) or is_admin_email(addr, admin_email):
            raise HTTPException(status_code=400, detail="cannot remove this account")
        target = tenants.get_user(addr)
        if target is None or target.workspace_id != owner.workspace_id:
            raise HTTPException(status_code=404, detail="user not found")
        tenants.delete_user(addr)

    @app.post("/api/admin/view", status_code=204)
    def admin_view(request: Request, body: AdminViewIn) -> Response:
        _require_admin(request)
        assert tenants is not None
        resp = Response(status_code=204)
        if not body.workspace_id:
            resp.delete_cookie(VIEW_COOKIE_NAME, path="/")
            return resp
        if tenants.get_workspace(body.workspace_id) is None:
            raise HTTPException(status_code=404, detail="workspace not found")
        resp.set_cookie(
            VIEW_COOKIE_NAME, sign_view(body.workspace_id, auth_secret), **_cookie_kw(request),
        )
        return resp

    @app.post("/api/jobs", status_code=201, response_model=CreateJobResponse)
    async def create_job(files: list[UploadFile], count: int = Form(...),
                          allow_creative_escalate: bool = Form(True),
                          quality_mode: str = Form("fast"),
                          generate_captions: bool = Form(False),
                          caption_prompt: str = Form(""),
                          caption_prompts: str = Form("")) -> CreateJobResponse:
        uploads = [(f.filename or "video.mp4", await f.read()) for f in files]
        job = store.create_job(
            uploads, count=count, allow_creative_escalate=allow_creative_escalate,
            quality_mode=quality_mode, generate_captions=generate_captions,
            caption_prompt=caption_prompt,
            caption_prompts=parse_caption_prompts_field(caption_prompts),
        )
        return CreateJobResponse(job_id=job.job_id,
                                 sources=[_source_out(s, ok_only=True, job=job, ws=store._ws)
                                          for s in job.sources])

    @app.post("/api/uploads")
    def init_upload(filename: str = Form(...), size: int = Form(...)) -> dict:
        """Start a chunked upload (RunPod HTTP proxy drops large multipart bodies)."""
        upload_id = uuid.uuid4().hex[:12]
        safe = os.path.basename(filename) or "video.mp4"
        path = store._ws.upload_blob_path(upload_id, safe)
        open(path, "wb").close()
        _UPLOAD_META[upload_id] = {"filename": safe, "size": int(size), "received": 0, "path": path}
        return {"upload_id": upload_id, "chunk_hint": 2_000_000}

    @app.put("/api/uploads/{upload_id}")
    async def put_upload_chunk(upload_id: str, request: Request, offset: int = 0) -> dict:
        meta = _UPLOAD_META.get(upload_id)
        if meta is None:
            raise HTTPException(status_code=404, detail="upload not found")
        try:
            data = await request.body()
        except ClientDisconnect as exc:
            raise HTTPException(
                status_code=400,
                detail="Upload dropped — hit Generate again.",
            ) from exc
        path = meta["path"]
        with open(path, "r+b") as f:
            f.seek(int(offset))
            f.write(data)
            received = f.tell()
            # if writing past EOF with holes, size is max
            f.seek(0, os.SEEK_END)
            received = max(received, f.tell())
        meta["received"] = max(meta["received"], received)
        return {"received": meta["received"]}

    @app.post("/api/jobs/from-uploads", status_code=201, response_model=CreateJobResponse)
    def create_job_from_uploads(
        upload_ids: str = Form(...),
        count: int = Form(...),
        allow_creative_escalate: bool = Form(True),
        quality_mode: str = Form("fast"),
        generate_captions: bool = Form(False),
        caption_prompt: str = Form(""),
        caption_prompts: str = Form(""),
    ) -> CreateJobResponse:
        ids = [u.strip() for u in upload_ids.split(",") if u.strip()]
        if not ids:
            raise HTTPException(status_code=400, detail="upload_ids required")
        paths: list[tuple[str, str]] = []
        for uid in ids:
            meta = _UPLOAD_META.get(uid)
            if meta is None:
                raise HTTPException(status_code=404, detail=f"upload not found: {uid}")
            if meta["received"] <= 0 or not os.path.exists(meta["path"]):
                raise HTTPException(status_code=400, detail=f"upload incomplete: {uid}")
            paths.append((meta["filename"], meta["path"]))
        job = store.create_job_from_paths(
            paths, count=count, allow_creative_escalate=allow_creative_escalate,
            quality_mode=quality_mode,             generate_captions=generate_captions,
            caption_prompt=caption_prompt,
            caption_prompts=parse_caption_prompts_field(caption_prompts),
        )
        for uid in ids:
            _UPLOAD_META.pop(uid, None)
        return CreateJobResponse(job_id=job.job_id,
                                 sources=[_source_out(s, ok_only=True, job=job, ws=store._ws)
                                          for s in job.sources])

    @app.post("/api/jobs/from-drive", status_code=201, response_model=CreateJobResponse)
    def create_job_from_drive(body: JobFromDriveIn) -> CreateJobResponse:
        _require_drive()
        dest = app.state.destinations.get(body.destination_id)
        if dest is None:
            raise HTTPException(status_code=404, detail="destination not found")
        file_ids = [fid.strip() for fid in body.file_ids if str(fid).strip()]
        if not file_ids:
            raise HTTPException(status_code=400, detail="file_ids required")
        children = {
            f.id: f for f in _drive().list_files(dest.folder_id) if is_video_file(f)
        }
        missing = [fid for fid in file_ids if fid not in children]
        if missing:
            raise HTTPException(status_code=400, detail="file is not a video in that folder")
        stage = tempfile.mkdtemp(prefix="vm_drive_in_", dir=store._ws.root)
        paths: list[tuple[str, str]] = []
        try:
            for i, fid in enumerate(file_ids):
                f = children[fid]
                name = os.path.basename(f.name) or "clip.mp4"
                local = os.path.join(stage, f"{i}_{name}")
                _drive().download(fid, local)
                paths.append((name, local))
            job = store.create_job_from_paths(
                paths, count=body.count,
                allow_creative_escalate=body.allow_creative_escalate,
                quality_mode=body.quality_mode,
                generate_captions=body.generate_captions,
                caption_prompt=body.caption_prompt,
                caption_prompts=list(body.caption_prompts or []),
            )
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        return CreateJobResponse(job_id=job.job_id,
                                 sources=[_source_out(s, ok_only=True, job=job, ws=store._ws)
                                          for s in job.sources])

    @app.get("/api/jobs", response_model=list[JobSummary])
    def list_jobs() -> list[JobSummary]:
        return [JobSummary(job_id=j.job_id, count=j.count, created_utc=j.created_utc,
                           state=j.state, source_count=len(j.sources))
                for j in store.list()]

    @app.get("/api/queue", response_model=QueueOut)
    def studio_queue() -> QueueOut:
        """Who is generating on this shared URL. Filenames only — no video bytes."""
        return QueueOut(**store.queue())

    @app.get("/api/jobs/{job_id}", response_model=JobDetail)
    def get_job(job_id: str) -> JobDetail:
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return JobDetail(job_id=job.job_id, count=job.count, created_utc=job.created_utc,
                         state=job.state,
                         sources=[_source_out(s, ok_only=True, job=job, ws=store._ws)
                                  for s in job.sources],
                         error=job.error)

    @app.post("/api/jobs/{job_id}/cancel", response_model=JobDetail)
    def cancel_job(job_id: str) -> JobDetail:
        job = store.cancel(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return JobDetail(job_id=job.job_id, count=job.count, created_utc=job.created_utc,
                         state=job.state,
                         sources=[_source_out(s, ok_only=True, job=job, ws=store._ws)
                                  for s in job.sources],
                         error=job.error)

    @app.get("/api/jobs/{job_id}/events-snapshot", response_model=JobEventsSnapshot)
    def job_events_snapshot(job_id: str) -> JobEventsSnapshot:
        """Non-streaming event log for proxies that buffer SSE (e.g. RunPod HTTP)."""
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return JobEventsSnapshot(
            job_id=job.job_id,
            state=job.state,
            events=[event_to_dict(e) for e in job.events],
        )

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(job_id: str):
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")

        async def gen():
            sent = 0
            while True:
                # drain newly-appended events from the in-memory log
                while sent < len(job.events):
                    yield {"data": json.dumps(event_to_dict(job.events[sent]))}
                    sent += 1
                if job.state in ("done", "cancelled") and sent >= len(job.events):
                    yield {"data": json.dumps({"state": "job-done"})}
                    return
                await asyncio.sleep(0.1)

        return EventSourceResponse(gen())

    @app.get("/api/gallery", response_model=list[SourceOut])
    def gallery() -> list[SourceOut]:
        out = []
        for job in store.list():
            for s in job.sources:
                out.append(_source_out(s, ok_only=True, job=job, ws=store._ws))
        out.sort(key=lambda s: s.created_utc or "", reverse=True)
        return out

    @app.get("/api/diagnostics", response_model=list[DiagnosticsItem])
    def diagnostics() -> list[DiagnosticsItem]:
        return [DiagnosticsItem(source_id=v.source_id, index=v.index, filename=v.filename,
                                status=v.status, quality=v.quality)
                for v in store.diagnostics()]

    @app.get("/api/look/{source_id}/{filename}")
    def look_still(source_id: str, filename: str):
        """Source vs variant JPEG stills for the look-first visual test."""
        if not str(filename).startswith("look_") or not str(filename).endswith(".jpg"):
            raise HTTPException(status_code=404, detail="look still not found")
        path = store.find_variant(source_id, filename)
        if path is None:
            raise HTTPException(status_code=404, detail="look still not found")
        return FileResponse(path, media_type="image/jpeg")

    @app.get("/api/variants/{source_id}/{filename}")
    def variant_file(source_id: str, filename: str):
        path = store.find_variant(source_id, filename)
        if path is None:
            raise HTTPException(status_code=404, detail="variant not found")
        return FileResponse(path, media_type="video/mp4")

    @app.get("/api/sources/{source_id}/source")
    def source_file(source_id: str):
        path = store.source_file(source_id)
        if path is None:
            raise HTTPException(status_code=404, detail="source not found")
        return FileResponse(path, media_type="video/mp4")

    @app.post("/api/sources/{source_id}/regenerate", response_model=SourceOut)
    def regenerate(source_id: str, n: int = Form(...)) -> SourceOut:
        source = store.regenerate(source_id, n)
        if source is None:
            raise HTTPException(status_code=404, detail="source not found")
        loc = store._locate(source_id)
        job = store.get(loc[0]) if loc else None
        return _source_out(source, ok_only=True, job=job, ws=store._ws)

    @app.post("/api/sources/{source_id}/retry-copy", response_model=SourceOut)
    def retry_copy(source_id: str) -> SourceOut:
        source = store.retry_copy(source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="source not found")
        loc = store._locate(source_id)
        job = store.get(loc[0]) if loc else None
        return _source_out(source, ok_only=True, job=job, ws=store._ws)

    @app.delete("/api/sources/{source_id}", status_code=204)
    def delete_source(source_id: str) -> None:
        if not store.delete_source(source_id):
            raise HTTPException(status_code=404, detail="source not found")

    @app.post("/api/sources/{source_id}/captions", response_model=SourceOut)
    def rewrite_captions(source_id: str, body: CaptionRewriteIn) -> SourceOut:
        source = store.rewrite_captions(source_id, body.prompt)
        if source is None:
            raise HTTPException(status_code=404, detail="source not found")
        loc = store._locate(source_id)
        job = store.get(loc[0]) if loc else None
        return _source_out(source, ok_only=True, job=job, ws=store._ws)

    @app.post("/api/variants/{source_id}/{index}/platform-result", response_model=VariantOut)
    def set_platform_result(source_id: str, index: int, body: PlatformResultIn) -> VariantOut:
        variant = store.set_platform_result(source_id, index, body.result)
        if variant is None:
            raise HTTPException(status_code=404, detail="variant not found")
        _sync_platform_result_to_sheet(source_id, index, body.result)
        loc = store._locate(source_id)
        file_ready = True
        if loc is not None:
            file_ready = variant_on_disk(store._ws, loc[0], source_id, variant.filename)
        return _variant_out(source_id, variant, file_ready=file_ready)

    @app.post("/api/variants/{source_id}/{index}/post-url", response_model=VariantOut)
    def set_post_url(source_id: str, index: int, body: PostUrlIn) -> VariantOut:
        try:
            url = normalize_post_url(body.url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        variant = store.set_post_url(source_id, index, url)
        if variant is None:
            raise HTTPException(status_code=404, detail="variant not found")
        _sync_post_url_to_sheet(source_id, index, url)
        loc = store._locate(source_id)
        file_ready = True
        if loc is not None:
            file_ready = variant_on_disk(store._ws, loc[0], source_id, variant.filename)
        return _variant_out(source_id, variant, file_ready=file_ready)

    @app.post("/api/variants/{source_id}/{index}/caption", response_model=VariantOut)
    def set_caption(source_id: str, index: int, body: CaptionIn) -> VariantOut:
        variant = store.set_caption(source_id, index, body.caption)
        if variant is None:
            raise HTTPException(status_code=404, detail="variant not found")
        loc = store._locate(source_id)
        file_ready = True
        if loc is not None:
            file_ready = variant_on_disk(store._ws, loc[0], source_id, variant.filename)
        return _variant_out(source_id, variant, file_ready=file_ready)

    @app.get("/api/drop-ledger/status", response_model=DropLedgerStatusOut)
    def drop_ledger_status() -> DropLedgerStatusOut:
        sid = _current_sheet_id()
        if sid:
            return DropLedgerStatusOut(
                configured=True, spreadsheet_id=sid,
                spreadsheet_url=spreadsheet_url(sid),
                message="Drop Ledger is ready",
            )
        if _sheets() is None:
            return DropLedgerStatusOut(
                configured=False,
                message="Connect Google first (Settings → Drive), then tap Ensure sheet to create VaryForge Drop Ledger",
            )
        return DropLedgerStatusOut(
            configured=False,
            message="No sheet yet — tap Ensure sheet to create VaryForge Drop Ledger",
        )

    @app.post("/api/drop-ledger/ensure", response_model=DropLedgerEnsureOut)
    def drop_ledger_ensure() -> DropLedgerEnsureOut:
        sheets_client = _require_sheets()
        existing = _current_sheet_id()
        created = existing is None
        sid = ensure_ledger(sheets_client, existing)
        _persist_sheet_id(sid)
        return DropLedgerEnsureOut(
            spreadsheet_id=sid, spreadsheet_url=spreadsheet_url(sid), created=created,
        )

    @app.post("/api/drop-ledger/sync", response_model=DropLedgerSyncOut)
    def drop_ledger_sync(body: DropLedgerSyncIn | None = None) -> DropLedgerSyncOut:
        sheets_client = _require_sheets()
        body = body or DropLedgerSyncIn()
        sid = _current_sheet_id()
        if body.ensure or not sid:
            sid = ensure_ledger(sheets_client, sid)
            _persist_sheet_id(sid)
        assert sid is not None
        job_ids = body.job_ids or list_job_ids_on_disk(store._ws.root)
        rows: list = []
        for jid in job_ids:
            rows.extend(load_manifest_rows(store._ws.root, jid))
        stats = sync_rows(sheets_client, sid, rows)
        return DropLedgerSyncOut(
            spreadsheet_id=sid,
            spreadsheet_url=spreadsheet_url(sid),
            job_ids=list(job_ids),
            rows=len(rows),
            inserted=stats["inserted"],
            updated=stats["updated"],
            unchanged=stats["unchanged"],
        )

    @app.get("/api/sources/{source_id}/zip")
    def source_zip(source_id: str):
        path = store.zip_ok_variants(source_id)
        if path is None:
            raise HTTPException(status_code=404, detail="no ok variants for source")
        return FileResponse(path, media_type="application/zip",
                            filename=f"{source_id}_variants.zip")

    @app.get("/api/drive/status", response_model=DriveStatusOut)
    def drive_status() -> DriveStatusOut:
        _refresh_drive_info()
        return _drive_status_out(_drive_info())

    @app.get("/api/drive/oauth/start")
    def drive_oauth_start(request: Request):
        if not oauth_env.get(ENV_OAUTH_CLIENT_ID) or not oauth_env.get(ENV_OAUTH_CLIENT_SECRET):
            raise HTTPException(
                status_code=503,
                detail="OAuth not configured — set VARIANT_DRIVE_OAUTH_CLIENT_ID and "
                       "VARIANT_DRIVE_OAUTH_CLIENT_SECRET",
            )
        state = new_oauth_state()
        _oauth_pending().add(state)
        redirect_uri = _redirect_uri_for(request)
        url = build_authorization_url(
            client_id=oauth_env[ENV_OAUTH_CLIENT_ID],
            redirect_uri=redirect_uri,
            state=state,
        )
        return RedirectResponse(url=url, status_code=302)

    @app.get("/api/drive/oauth/callback")
    def drive_oauth_callback(request: Request, code: str | None = None, state: str | None = None,
                             error: str | None = None):
        if error:
            return RedirectResponse(url=_settings_url(request, f"oauth=error&reason={error}"),
                                    status_code=302)
        if not code or not state:
            return RedirectResponse(url=_settings_url(request, "oauth=error&reason=missing_code"),
                                    status_code=302)
        if not _oauth_pending().consume(state):
            return RedirectResponse(url=_settings_url(request, "oauth=error&reason=bad_state"),
                                    status_code=302)

        client_id = oauth_env.get(ENV_OAUTH_CLIENT_ID, "")
        client_secret = oauth_env.get(ENV_OAUTH_CLIENT_SECRET, "")
        redirect_uri = _redirect_uri_for(request)
        try:
            token_data = app.state.oauth_exchange(
                code=code,
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=redirect_uri,
            )
            email = app.state.oauth_fetch_email(token_data)
            if email:
                token_data = {**token_data, "email": email}
            # Persist client secrets alongside token so GoogleDrive can refresh headless
            token_data.setdefault("client_id", client_id)
            token_data.setdefault("client_secret", client_secret)
            _oauth_tokens().save(token_data)
        except Exception as exc:
            print(f"oauth exchange failed: {exc}", flush=True)
            traceback.print_exc()
            return RedirectResponse(url=_settings_url(request, "oauth=error&reason=exchange_failed"),
                                    status_code=302)

        client, sheets_client = _attach_oauth_clients()
        _set_drive(client)
        if sheets_client is not None:
            _set_sheets(sheets_client)
        _refresh_drive_info()
        return RedirectResponse(url=_settings_url(request, "oauth=connected"), status_code=302)

    @app.post("/api/drive/oauth/disconnect")
    def drive_oauth_disconnect() -> dict:
        _oauth_tokens().clear()
        info = _drive_info()
        if info.auth_mode == "oauth":
            _set_drive(None)
            _set_sheets(None)
        _refresh_drive_info()
        info = _drive_info()
        if (
            _drive() is None
            and info.status == "ready"
            and info.auth_mode == "service_account"
            and sa_arg
        ):
            _set_drive(_build_drive_client(sa_json_path=sa_arg))
        return {"ok": True}

    @app.get("/api/drive/destinations", response_model=list[DestinationOut])
    def list_destinations() -> list[DestinationOut]:
        return [_destination_out(d) for d in app.state.destinations.list()]

    @app.post("/api/drive/destinations", status_code=201, response_model=DestinationOut)
    def create_destination(body: DestinationCreateIn) -> DestinationOut:
        _require_drive()
        try:
            folder_id = _resolve_folder_id(body.folder_url)
        except DriveUrlError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        auth_mode = _drive_info().auth_mode or "service_account"
        try:
            probe_folder_writable(
                _drive(), folder_id,
                sa_email=_account_email(), auth_mode=auth_mode,
            )
        except DestinationError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        dest = app.state.destinations.create(
            name=body.name, folder_id=folder_id, auth_mode=auth_mode,
        )
        return _destination_out(dest)

    @app.patch("/api/drive/destinations/{dest_id}", response_model=DestinationOut)
    def update_destination(dest_id: str, body: DestinationUpdateIn) -> DestinationOut:
        _require_drive()
        existing = app.state.destinations.get(dest_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="destination not found")
        folder_id = None
        auth_mode = _drive_info().auth_mode or existing.auth_mode
        if body.folder_url is not None:
            try:
                folder_id = _resolve_folder_id(body.folder_url)
            except DriveUrlError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            if folder_id != existing.folder_id:
                try:
                    probe_folder_writable(
                        _drive(), folder_id,
                        sa_email=_account_email(), auth_mode=auth_mode,
                    )
                except DestinationError as e:
                    raise HTTPException(status_code=400, detail=str(e)) from e
        updated = app.state.destinations.update(dest_id, name=body.name, folder_id=folder_id)
        return _destination_out(updated)

    @app.delete("/api/drive/destinations/{dest_id}", status_code=204)
    def delete_destination(dest_id: str) -> None:
        _require_drive()
        if not app.state.destinations.delete(dest_id):
            raise HTTPException(status_code=404, detail="destination not found")

    @app.post("/api/drive/destinations/{dest_id}/test")
    def test_destination(dest_id: str) -> dict:
        _require_drive()
        dest = app.state.destinations.get(dest_id)
        if dest is None:
            raise HTTPException(status_code=404, detail="destination not found")
        try:
            probe_folder_writable(
                _drive(), dest.folder_id,
                sa_email=_account_email(),
                auth_mode=_drive_info().auth_mode or dest.auth_mode,
            )
        except DestinationError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"ok": True}

    @app.get("/api/drive/destinations/{dest_id}/videos", response_model=DriveVideosOut)
    def list_destination_videos(dest_id: str) -> DriveVideosOut:
        _require_drive()
        dest = app.state.destinations.get(dest_id)
        if dest is None:
            raise HTTPException(status_code=404, detail="destination not found")
        videos = [
            DriveVideoOut(id=f.id, name=f.name, mime_type=f.mime_type, md5=f.md5)
            for f in _drive().list_files(dest.folder_id)
            if is_video_file(f)
        ]
        return DriveVideosOut(videos=videos)

    @app.get("/api/workflows", response_model=list[WorkflowOut])
    def list_workflows() -> list[WorkflowOut]:
        return [_workflow_out(w) for w in app.state.workflows.list()]

    def _require_distinct_workflow_folders(inbox_dest_id: str, output_dest_id: str) -> None:
        inbox = app.state.destinations.get(inbox_dest_id)
        output = app.state.destinations.get(output_dest_id)
        if inbox is None:
            raise HTTPException(status_code=400, detail="unknown inbox destination")
        if output is None:
            raise HTTPException(status_code=400, detail="unknown output destination")
        if inbox.id == output.id or inbox.folder_id == output.folder_id:
            raise HTTPException(
                status_code=400, detail="inbox and output folders must be different",
            )

    @app.post("/api/workflows", status_code=201, response_model=WorkflowOut)
    def create_workflow(body: WorkflowCreateIn) -> WorkflowOut:
        _require_distinct_workflow_folders(body.inbox_destination_id, body.output_destination_id)
        try:
            wf = app.state.workflows.create(
                name=body.name,
                inbox_destination_id=body.inbox_destination_id,
                output_destination_id=body.output_destination_id,
                count=body.count,
                quality_mode=body.quality_mode,
                allow_creative_escalate=body.allow_creative_escalate,
                enabled=body.enabled,
                poll_seconds=body.poll_seconds,
                auto_caption=body.auto_caption,
                caption_bank_id=body.caption_bank_id or "",
                caption_from_filename=body.caption_from_filename,
            )
        except WorkflowError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return _workflow_out(wf)

    @app.patch("/api/workflows/{workflow_id}", response_model=WorkflowOut)
    def update_workflow(workflow_id: str, body: WorkflowUpdateIn) -> WorkflowOut:
        existing = app.state.workflows.get(workflow_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        inbox_id = existing.inbox_destination_id if body.inbox_destination_id is None else body.inbox_destination_id
        output_id = existing.output_destination_id if body.output_destination_id is None else body.output_destination_id
        _require_distinct_workflow_folders(inbox_id, output_id)
        try:
            updated = app.state.workflows.update(
                workflow_id,
                name=body.name,
                inbox_destination_id=body.inbox_destination_id,
                output_destination_id=body.output_destination_id,
                count=body.count,
                quality_mode=body.quality_mode,
                allow_creative_escalate=body.allow_creative_escalate,
                enabled=body.enabled,
                poll_seconds=body.poll_seconds,
                auto_caption=body.auto_caption,
                caption_bank_id=body.caption_bank_id,
                caption_from_filename=body.caption_from_filename,
            )
        except WorkflowError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if updated is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        return _workflow_out(updated)

    @app.delete("/api/workflows/{workflow_id}", status_code=204)
    def delete_workflow(workflow_id: str) -> None:
        if not app.state.workflows.delete(workflow_id):
            raise HTTPException(status_code=404, detail="workflow not found")
        ledger_path = store._ws.workflow_ledger_path(workflow_id)
        try:
            os.remove(ledger_path)
        except OSError:
            pass

    @app.post("/api/workflows/{workflow_id}/run", response_model=WorkflowOut)
    def run_workflow(workflow_id: str) -> WorkflowOut:
        _require_drive()
        wf = app.state.workflows.get(workflow_id)
        if wf is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        return _workflow_out(_run_workflow_tick(wf))

    @app.post("/api/workflows/{workflow_id}/cancel", response_model=WorkflowOut)
    def cancel_workflow(workflow_id: str) -> WorkflowOut:
        wf = app.state.workflows.get(workflow_id)
        if wf is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        extra = list((wf.last_summary or {}).get("job_ids") or [])
        with app.state.workflow_tick_lock:
            ledger = Ledger(store._ws.workflow_ledger_path(wf.id))
            cancel_workflow_jobs(ledger, store, extra_job_ids=extra)
            summary = dict(wf.last_summary or {})
            summary["running"] = 0
            updated = app.state.workflows.update(
                wf.id,
                enabled=False,
                last_sweep_at=wf.last_sweep_at,
                last_summary=summary,
                touch_sweep=True,
            )
        return _workflow_out(updated or wf)

    @app.get("/api/caption-banks", response_model=list[CaptionBankFolderOut])
    def list_caption_banks() -> list[CaptionBankFolderOut]:
        return [_caption_folder_out(m) for m in app.state.captions.list_banks()]

    @app.post("/api/caption-banks", status_code=201, response_model=CaptionBankFolderOut)
    def create_caption_bank(body: CaptionFolderCreateIn) -> CaptionBankFolderOut:
        try:
            return _caption_folder_out(app.state.captions.create_bank(body.name))
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.patch("/api/caption-banks/{bank_id}", response_model=CaptionBankFolderOut)
    def rename_caption_bank(bank_id: str, body: CaptionFolderCreateIn) -> CaptionBankFolderOut:
        try:
            meta = app.state.captions.rename_bank(bank_id, body.name)
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if meta is None:
            raise HTTPException(status_code=404, detail="caption folder not found")
        return _caption_folder_out(meta)

    @app.delete("/api/caption-banks/{bank_id}", status_code=204)
    def delete_caption_bank(bank_id: str) -> None:
        try:
            ok = app.state.captions.delete_bank(bank_id)
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if not ok:
            raise HTTPException(status_code=404, detail="caption folder not found")

    @app.get("/api/captions", response_model=CaptionBankOut)
    def list_captions(bank_id: str | None = None) -> CaptionBankOut:
        return _caption_bank_payload(app.state.captions, bank_id)

    @app.get("/api/captions/preview", response_model=CaptionPreviewOut)
    def preview_captions(n: int = 1, bank_id: str | None = None) -> CaptionPreviewOut:
        return CaptionPreviewOut(captions=app.state.captions.peek(max(0, n), bank_id=bank_id))

    @app.post("/api/captions", status_code=201, response_model=CaptionOut)
    def create_caption(body: CaptionCreateIn) -> CaptionOut:
        try:
            cap = app.state.captions.add(body.text, bank_id=body.bank_id)
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return CaptionOut(id=cap.id, text=cap.text)

    @app.post("/api/captions/bulk", status_code=201, response_model=CaptionBankOut)
    def bulk_captions(body: CaptionBulkIn) -> CaptionBankOut:
        try:
            app.state.captions.add_many(split_caption_bank(body.raw), bank_id=body.bank_id)
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return _caption_bank_payload(app.state.captions, body.bank_id)

    @app.patch("/api/captions/{caption_id}", response_model=CaptionOut)
    def update_caption(caption_id: str, body: CaptionCreateIn) -> CaptionOut:
        try:
            cap = app.state.captions.update(caption_id, body.text)
        except CaptionError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if cap is None:
            raise HTTPException(status_code=404, detail="caption not found")
        return CaptionOut(id=cap.id, text=cap.text)

    @app.delete("/api/captions/{caption_id}", status_code=204)
    def delete_caption(caption_id: str) -> None:
        if not app.state.captions.delete(caption_id):
            raise HTTPException(status_code=404, detail="caption not found")

    @app.post("/api/captions/advance", response_model=CaptionBankOut)
    def advance_captions(body: CaptionAdvanceIn) -> CaptionBankOut:
        app.state.captions.advance(body.n, bank_id=body.bank_id)
        return _caption_bank_payload(app.state.captions, body.bank_id)

    @app.post("/api/drive/exports", status_code=201, response_model=ExportJobOut)
    def create_export(body: ExportCreateIn) -> ExportJobOut:
        _require_drive()
        dest = app.state.destinations.get(body.destination_id)
        if dest is None:
            raise HTTPException(status_code=404, detail="destination not found")
        refs = [
            VariantRef(source_id=v.source_id, index=v.index, caption=v.caption)
            for v in body.variants
        ]
        try:
            files = build_export_files(store, refs)
        except ExportError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if body.consume_bank:
            app.state.captions.advance(len(files), bank_id=body.caption_bank_id)
        job = app.state.exports.create(destination_id=dest.id, folder_id=dest.folder_id, files=files)
        ExportRunner(_drive(), app.state.exports).start(job)
        return _export_job_out(job)

    @app.get("/api/drive/exports", response_model=list[DropPackOut])
    def list_exports() -> list[DropPackOut]:
        packs = build_drop_packs(
            app.state.exports.list(), app.state.destinations, store,
        )
        return [_drop_pack_out(p) for p in packs]

    @app.post("/api/drive/exports/split", status_code=201, response_model=SplitExportOut)
    def split_export(body: ExportSplitIn) -> SplitExportOut:
        """Partition one generate across Main/Trial/Growth. No re-render."""
        _require_drive()
        return execute_split_export(
            drive=_drive(),
            job_store=store,
            dest_store=app.state.destinations,
            export_store=app.state.exports,
            caption_store=app.state.captions,
            body=body,
        )

    @app.get("/api/drive/exports/{export_id}", response_model=ExportJobOut)
    def get_export(export_id: str) -> ExportJobOut:
        job = app.state.exports.get(export_id)
        if job is None:
            raise HTTPException(status_code=404, detail="export not found")
        return _export_job_out(job)

    @app.post("/api/drive/exports/{export_id}/retry", response_model=ExportJobOut)
    def retry_export(export_id: str) -> ExportJobOut:
        _require_drive()
        try:
            job = ExportRunner(_drive(), app.state.exports).retry_failed(export_id)
        except ExportError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        return _export_job_out(job)

    if enable_workflow_poller:
        stop = threading.Event()
        app.state.workflow_poller_stop = stop

        def _workflow_poll_delay() -> float:
            if auth_on and tenants is not None and hub is not None:
                secs: list[int] = []
                for ws_id in tenants.list_workspace_ids():
                    secs.extend(
                        w.poll_seconds for w in hub.bundle(ws_id).workflows.list() if w.enabled
                    )
                return float(min(secs)) if secs else 30.0
            enabled = [w.poll_seconds for w in app.state.workflows.list() if w.enabled]
            return float(min(enabled)) if enabled else 30.0

        def _poll_loop() -> None:
            while not stop.wait(timeout=_workflow_poll_delay()):
                try:
                    if auth_on and tenants is not None and hub is not None:
                        for ws_id in tenants.list_workspace_ids():
                            token = tenant_cv.set(hub.bundle(ws_id))
                            try:
                                for wf in app.state.workflows.list():
                                    if wf.enabled:
                                        _run_workflow_tick(wf)
                            finally:
                                tenant_cv.reset(token)
                    else:
                        for wf in app.state.workflows.list():
                            if wf.enabled:
                                _run_workflow_tick(wf)
                except Exception as exc:  # noqa: BLE001 — poller must not die on one sweep
                    print(f"workflow poller: {type(exc).__name__}: {exc}", flush=True)

        threading.Thread(target=_poll_loop, name="workflow-poller", daemon=True).start()

    return app
