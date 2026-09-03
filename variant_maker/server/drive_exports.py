"""Drive export: eligibility filtering, sequential upload runner, per-job persistence.

An export takes a selection of already-rendered variants (`VariantRef`s), filters to the
ones that actually exist and passed quality (`status == "ok"`), then uploads them to a
Drive folder one at a time, renaming on name collisions (`unique_upload_name`). Progress
is persisted to disk after every file so a client can poll `ExportStore.get` for status
and a failed upload can be retried without touching files that already succeeded.
"""
from __future__ import annotations

import dataclasses
import datetime as _dt
import json
import os
import secrets
import tempfile
import threading
from dataclasses import dataclass, field

from variant_maker.farm.drive import DriveClient
from variant_maker.server.captions import caption_filename
from variant_maker.server.drive_names import unique_upload_name
from variant_maker.server.jobs import JobStore


class ExportError(Exception):
    """Raised when an export cannot be built or acted on (e.g. no eligible variants)."""


@dataclass
class VariantRef:
    source_id: str
    index: int
    caption: str | None = None


@dataclass
class ExportFile:
    source_id: str
    index: int
    filename: str
    local_path: str
    status: str  # pending | uploading | succeeded | failed
    error: str | None = None
    drive_file_id: str | None = None


@dataclass
class ExportJob:
    export_id: str
    destination_id: str
    folder_id: str
    state: str  # pending | running | succeeded | partial | failed
    created_utc: str
    files: list[ExportFile] = field(default_factory=list)


def _now() -> str:
    return (_dt.datetime.now(_dt.timezone.utc).replace(microsecond=0)
            .isoformat().replace("+00:00", "Z"))


def build_export_files(job_store: JobStore, refs: list[VariantRef]) -> list[ExportFile]:
    """Resolve refs to on-disk, quality-passing variants. Anything missing (variant,
    file) or not `status == "ok"` is silently dropped from the export selection."""
    files: list[ExportFile] = []
    for ref in refs:
        variant = job_store.get_variant(ref.source_id, ref.index)
        if variant is None or variant.status != "ok":
            continue
        local_path = job_store.find_variant(ref.source_id, variant.filename)
        if local_path is None:
            continue
        if (ref.caption or "").strip():
            job_store.set_caption(ref.source_id, ref.index, ref.caption or "")
        files.append(ExportFile(
            source_id=ref.source_id, index=ref.index,
            filename=caption_filename(ref.caption, variant.filename),
            local_path=local_path, status="pending",
        ))
    if not files:
        raise ExportError("No ok videos in selection")
    return files


class ExportStore:
    """JSON-file-backed persistence for `ExportJob`s, one file per job."""

    def __init__(self, exports_dir: str) -> None:
        self._dir = exports_dir

    def create(self, *, destination_id: str, folder_id: str,
               files: list[ExportFile]) -> ExportJob:
        job = ExportJob(
            export_id=f"exp_{secrets.token_hex(6)}",
            destination_id=destination_id,
            folder_id=folder_id,
            state="pending",
            created_utc=_now(),
            files=files,
        )
        self.save(job)
        return job

    def get(self, export_id: str) -> ExportJob | None:
        path = self._path(export_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
            files = [ExportFile(**item) for item in raw.pop("files", [])]
            return ExportJob(files=files, **raw)
        except (OSError, json.JSONDecodeError, TypeError, KeyError, ValueError):
            return None

    def list(self) -> list[ExportJob]:
        """Newest export jobs first. Skips temp/corrupt files."""
        if not os.path.isdir(self._dir):
            return []
        jobs: list[ExportJob] = []
        try:
            names = os.listdir(self._dir)
        except OSError:
            return []
        for name in names:
            if not name.endswith(".json") or name.startswith("."):
                continue
            job = self.get(name[:-5])
            if job is not None:
                jobs.append(job)
        jobs.sort(key=lambda j: (j.created_utc or "", j.export_id), reverse=True)
        return jobs

    def save(self, job: ExportJob) -> None:
        path = self._path(job.export_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(path), prefix=f".{job.export_id}-", suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(dataclasses.asdict(job), f, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise

    def _path(self, export_id: str) -> str:
        return os.path.join(self._dir, f"{export_id}.json")


def _concrete_store(store: ExportStore) -> ExportStore:
    """Pin the tenant ExportStore. AttrProxy is request-scoped; the upload thread
    has no tenant context, so a proxy get() would miss the job and leave 0 / N."""
    inner = getattr(store, "_inner", None)
    if callable(inner):
        return inner()
    return store


class ExportRunner:
    """Uploads an `ExportJob`'s files to Drive sequentially, on a background thread."""

    def __init__(self, drive: DriveClient, export_store: ExportStore) -> None:
        self._drive = drive
        self._store = export_store

    def start(self, job: ExportJob) -> None:
        self._store = _concrete_store(self._store)
        job.state = "running"
        self._store.save(job)
        threading.Thread(target=self._run, args=(job.export_id,), daemon=True).start()

    def retry_failed(self, export_id: str) -> ExportJob:
        job = self._store.get(export_id)
        if job is None:
            raise ExportError(f"export not found: {export_id}")
        for f in job.files:
            if f.status == "failed":
                f.status = "pending"
                f.error = None
        self.start(job)
        return job

    def _run(self, export_id: str) -> None:
        job = self._store.get(export_id)
        if job is None:
            return
        for f in job.files:
            if f.status not in ("pending", "failed"):
                continue
            f.status = "uploading"
            f.error = None
            self._store.save(job)
            try:
                existing = {d.name for d in self._drive.list_files(job.folder_id)}
                name = unique_upload_name(f.filename, existing)
                f.drive_file_id = self._drive.upload(f.local_path, job.folder_id, name=name)
                f.status = "succeeded"
                f.error = None
            except Exception as exc:
                f.status = "failed"
                f.error = str(exc)
            self._store.save(job)

        statuses = {f.status for f in job.files}
        if statuses == {"succeeded"}:
            job.state = "succeeded"
        elif statuses == {"failed"}:
            job.state = "failed"
        else:
            job.state = "partial"
        self._store.save(job)
