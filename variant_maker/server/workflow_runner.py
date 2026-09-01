"""One Studio workflow tick: harvest finished jobs, then queue new inbox videos.

Uses JobStore (so Fast/HQ go through the same RunPod path as Generate) and the farm
ledger (sha256 idempotency). Output layout matches the farm runner: one Drive
subfolder `<stem>__<sha8>/` per source with ok variants + manifest.json.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import asdict, dataclass, field

from variant_maker.farm.drive import DriveClient, is_video_file
from variant_maker.farm.layout import source_output_subfolder
from variant_maker.farm.ledger import Ledger
from variant_maker.probe import sha256_file
from variant_maker.server.caption_ai import brief_from_filename, captions_for_source
from variant_maker.server.captions import CaptionStore, caption_filename
from variant_maker.server.jobs import COPY_FAILED_MSG, Job, JobSource, JobStore
from variant_maker.server.workflows import Workflow


@dataclass
class TickSummary:
    queued: int = 0
    exported: int = 0
    skipped: int = 0
    failed: int = 0
    running: int = 0
    job_ids: list[str] = field(default_factory=list)
    error: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def _exhausted(ledger: Ledger, sha: str, max_attempts: int) -> bool:
    rec = ledger.get(sha)
    return bool(rec and rec["status"] == "failed" and rec["attempts"] >= max_attempts)


def _settled(ledger: Ledger, sha: str, max_attempts: int) -> bool:
    return ledger.is_done(sha) or ledger.is_running(sha) or _exhausted(ledger, sha, max_attempts)


def _uploadable(source: JobSource) -> list:
    return [
        v for v in source.variants
        if v.status == "ok" and (not v.quality or v.quality.get("spatial_ok") is not False)
    ]


def _file_id_for_sha(ledger: Ledger, sha: str) -> str | None:
    for fid, entry in ledger._by_file_id.items():
        if entry.get("sha") == sha:
            return fid
    return None


def _md5_for_file(ledger: Ledger, file_id: str | None) -> str | None:
    if not file_id:
        return None
    entry = ledger._by_file_id.get(file_id)
    return entry.get("md5") if entry else None


def _captions_for_export(
    source: JobSource,
    variants: list,
    *,
    caption_store: CaptionStore | None,
    caption_bank_id: str | None,
    from_filename: bool,
) -> list[str | None]:
    if from_filename:
        planned = list(source.planned_captions or [])
        if len(planned) >= len(variants) and any(planned):
            return [(planned[i] if i < len(planned) else None) for i in range(len(variants))]
        if any(v.caption for v in variants):
            return [v.caption for v in variants]
        generated = captions_for_source(
            source.filename,
            len(variants),
            prompt=brief_from_filename(source.filename),
        )
        return [(generated[i] if i < len(generated) else None) for i in range(len(variants))]
    if caption_store is not None:
        return caption_store.take(len(variants), bank_id=caption_bank_id)
    return [None] * len(variants)


def _export_source(
    drive: DriveClient,
    job_store: JobStore,
    job: Job,
    source: JobSource,
    *,
    stem: str,
    sha: str,
    output_folder_id: str,
    caption_store: CaptionStore | None = None,
    caption_bank_id: str | None = None,
    from_filename: bool = False,
) -> tuple[str, int]:
    variants = _uploadable(source)
    if not variants:
        raise RuntimeError("no ok variants to export")
    sub_name = source_output_subfolder(stem, sha)
    sub_id = drive.find_or_create_folder(sub_name, output_folder_id)
    if not sub_id or sub_id == output_folder_id:
        raise RuntimeError("refusing to dump variants into the parent output folder")
    captions = _captions_for_export(
        source,
        variants,
        caption_store=caption_store,
        caption_bank_id=caption_bank_id,
        from_filename=from_filename,
    )
    uploaded = 0
    for i, v in enumerate(variants):
        path = job_store.find_variant(source.source_id, v.filename)
        if path is None:
            continue
        cap = captions[i] if i < len(captions) else None
        drive.upload(path, sub_id, name=caption_filename(cap, v.filename))
        uploaded += 1
    if uploaded == 0:
        raise RuntimeError(COPY_FAILED_MSG)
    manifest = os.path.join(job_store._ws.source_out_dir(job.job_id, source.source_id), "manifest.json")
    if os.path.isfile(manifest):
        drive.upload(manifest, sub_id, name="manifest.json")
    return sub_id, uploaded


def _harvest(
    ledger: Ledger,
    job_store: JobStore,
    drive: DriveClient,
    output_folder_id: str,
    summary: TickSummary,
    max_attempts: int,
    caption_store: CaptionStore | None = None,
    caption_bank_id: str | None = None,
    from_filename: bool = False,
) -> int:
    """Finish exports for jobs that left `running`. Returns how many are still in flight."""
    still = 0
    for sha, rec in list(ledger.running_records()):
        job_id = rec.get("job_id")
        job = job_store.get(job_id) if job_id else None
        file_id = _file_id_for_sha(ledger, sha)
        md5 = _md5_for_file(ledger, file_id)
        if job is None:
            ledger.mark_failed(sha, error="job missing", file_id=file_id, md5=md5)
            summary.failed += 1
            continue
        if job.state == "running":
            still += 1
            summary.running += 1
            if job_id and job_id not in summary.job_ids:
                summary.job_ids.append(job_id)
            continue
        filename = rec.get("filename") or (job.sources[0].filename if job.sources else "source")
        stem = os.path.splitext(str(filename))[0]
        if job.state == "cancelled":
            ledger.mark_failed(sha, error=job.error or "cancelled", file_id=file_id, md5=md5)
            summary.failed += 1
            continue
        try:
            if not job.sources:
                raise RuntimeError("job has no sources")
            source = job.sources[0]
            sub_id, n = _export_source(
                drive, job_store, job, source,
                stem=stem, sha=sha, output_folder_id=output_folder_id,
                caption_store=caption_store,
                caption_bank_id=caption_bank_id,
                from_filename=from_filename,
            )
        except Exception as e:  # noqa: BLE001 — isolate one clip, keep the sweep going
            ledger.mark_failed(sha, error=f"{type(e).__name__}: {e}", file_id=file_id, md5=md5)
            summary.failed += 1
            continue
        ledger.mark_done(
            sha, output_folder_id=sub_id, variant_count=n, file_id=file_id, md5=md5,
        )
        summary.exported += 1
    return still


def _queue_new(
    workflow: Workflow,
    drive: DriveClient,
    inbox_folder_id: str,
    job_store: JobStore,
    ledger: Ledger,
    work_dir: str,
    summary: TickSummary,
    *,
    max_attempts: int,
    slots: int,
) -> None:
    if slots <= 0:
        return
    os.makedirs(work_dir, exist_ok=True)
    videos = [f for f in drive.list_files(inbox_folder_id) if is_video_file(f)]
    for f in videos:
        if slots <= 0:
            break
        seen = ledger.seen_file(f.id, f.md5)
        if seen and _settled(ledger, seen, max_attempts):
            summary.skipped += 1
            continue

        job_dir = tempfile.mkdtemp(prefix="vm_wf_", dir=work_dir)
        local = os.path.join(job_dir, os.path.basename(f.name) or "clip.mp4")
        try:
            drive.download(f.id, local)
            sha = sha256_file(local)
            if ledger.is_done(sha):
                ledger.note_file_id(f.id, sha, f.md5)
                summary.skipped += 1
                shutil.rmtree(job_dir, ignore_errors=True)
                continue
            if ledger.is_running(sha) or _exhausted(ledger, sha, max_attempts):
                summary.skipped += 1
                shutil.rmtree(job_dir, ignore_errors=True)
                continue
            job = job_store.create_job_from_paths(
                [(os.path.basename(f.name) or "clip.mp4", local)],
                count=workflow.count,
                allow_creative_escalate=workflow.allow_creative_escalate,
                quality_mode=workflow.quality_mode,
                generate_captions=bool(workflow.caption_from_filename),
                caption_prompt=(
                    brief_from_filename(f.name) if workflow.caption_from_filename else ""
                ),
            )
            ledger.mark_running(
                sha, job_id=job.job_id, file_id=f.id, md5=f.md5, filename=f.name,
            )
            summary.queued += 1
            summary.running += 1
            if job.job_id not in summary.job_ids:
                summary.job_ids.append(job.job_id)
            slots -= 1
        except Exception as e:  # noqa: BLE001 — isolate one clip, keep the sweep going
            try:
                sha = sha256_file(local) if os.path.isfile(local) else f.id
            except Exception:  # noqa: BLE001
                sha = f.id
            ledger.mark_failed(sha, error=f"{type(e).__name__}: {e}", file_id=f.id, md5=f.md5)
            summary.failed += 1
        finally:
            shutil.rmtree(job_dir, ignore_errors=True)


def cancel_workflow_jobs(
    ledger: Ledger,
    job_store: JobStore,
    extra_job_ids: list[str] | None = None,
) -> list[str]:
    """Stop every in-flight pack for this workflow. Returns cancelled job ids."""
    cancelled: list[str] = []
    for _sha, rec in list(ledger.running_records()):
        job_id = rec.get("job_id")
        if not job_id:
            continue
        job_store.cancel(job_id)
        cancelled.append(job_id)
    for job_id in extra_job_ids or []:
        if job_id in cancelled:
            continue
        job = job_store.cancel(job_id)
        if job is not None:
            cancelled.append(job_id)
    return cancelled


def tick_workflow(
    workflow: Workflow,
    *,
    drive: DriveClient,
    inbox_folder_id: str,
    output_folder_id: str,
    job_store: JobStore,
    ledger: Ledger,
    work_dir: str,
    max_attempts: int = 3,
    max_inflight: int = 1,
    caption_store: CaptionStore | None = None,
) -> TickSummary:
    summary = TickSummary()
    if inbox_folder_id == output_folder_id:
        summary.error = "inbox and output folders must be different"
        return summary
    bank = caption_store if (workflow.auto_caption and not workflow.caption_from_filename) else None
    bank_id = workflow.caption_bank_id or None
    still = _harvest(ledger, job_store, drive, output_folder_id, summary, max_attempts,
                     caption_store=bank, caption_bank_id=bank_id,
                     from_filename=workflow.caption_from_filename)
    _queue_new(
        workflow, drive, inbox_folder_id, job_store, ledger, work_dir, summary,
        max_attempts=max_attempts, slots=max(0, max_inflight - still),
    )
    # FakeRunner (and very short Fast jobs) may already be done — export in this tick.
    done_already = False
    for jid in list(summary.job_ids):
        ev = job_store._done.get(jid)
        if ev is not None and ev.is_set():
            done_already = True
            break
    if done_already:
        # Don't double-count running from the first harvest; reset running then re-harvest.
        summary.running = 0
        still = _harvest(ledger, job_store, drive, output_folder_id, summary, max_attempts,
                         caption_store=bank, caption_bank_id=bank_id,
                         from_filename=workflow.caption_from_filename)
        summary.running = still
    return summary
