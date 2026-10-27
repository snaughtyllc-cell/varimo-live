"""Opt-in winner routing. No global Drive search and no writes during preview.

Journal intent before each external write. An ambiguous upload is held for operator
reconciliation, never silently retried into a watched posting folder.
"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import re
import tempfile
import unicodedata

from variant_maker.farm.drive import is_video_file


def segment(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 120:
        raise ValueError("Invalid Postdesk folder name")
    if (
        value != value.strip()
        or value in (".", "..")
        or any(c in "/\\" or unicodedata.category(c).startswith("C") for c in value)
    ):
        raise ValueError("Invalid Postdesk folder name")
    return value


def validate_target(raw: object) -> dict:
    fields = {"source_file_id", "model", "page", "winner"}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise ValueError("HQ target requires source_file_id, model, page and winner")
    if not isinstance(raw["source_file_id"], str) or not re.fullmatch(
        r"[A-Za-z0-9_-]{1,200}", raw["source_file_id"]
    ):
        raise ValueError("Invalid source file ID")
    return {
        "source_file_id": raw["source_file_id"],
        **{k: segment(raw[k]) for k in ("model", "page", "winner")},
    }


def child_folder(drive, parent: str, name: str) -> str:
    matches = [f for f in drive.list_files(parent) if f.name == name]
    if len(matches) != 1 or not matches[0].is_folder:
        raise ValueError(f"Expected one existing folder named {name}")
    if matches[0].id == parent:
        raise ValueError("Invalid Drive folder relationship")
    return matches[0].id


def resolve_target_folder(drive, destinations, target: dict) -> str:
    target = validate_target(target)
    roots = [d for d in destinations.list() if d.name == "Postdesk: " + target["model"]]
    if len(roots) != 1:
        raise ValueError("Register exactly one Postdesk: <model> destination in this workspace")
    folder = roots[0].folder_id
    if not drive.get_file(folder).is_folder:
        raise ValueError("Postdesk destination is not a folder")
    for part in (target["page"], "To Post", "Winners"):
        folder = child_folder(drive, folder, part)
    return folder


def authorized_source(drive, destinations, target: dict):
    """Source must be under a model root explicitly registered in this tenant."""
    names = {"Postdesk: " + target["model"], "Postdesk source: " + target["model"]}
    roots = [d for d in destinations.list() if d.name in names]
    if not roots:
        raise ValueError("Postdesk model is not registered in this workspace")
    root_ids = {d.folder_id for d in roots}
    source = drive.get_file(target["source_file_id"])
    if not is_video_file(source):
        raise ValueError("HQ source is not a video")
    seen = set()
    node = source
    for _ in range(32):
        if node.id in seen:
            break
        seen.add(node.id)
        parents = tuple(getattr(node, "parents", ()))
        if root_ids.intersection(parents):
            return source
        if len(parents) != 1:
            break
        node = drive.get_file(parents[0])
    raise ValueError("Source is outside this workspace registered model source folders")


def save(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".postdesk-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@contextlib.contextmanager
def locked(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".lock", "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def handoff_path(root: str, workspace: str, target: dict) -> tuple[str, str]:
    key = hashlib.sha256(
        json.dumps(
            [workspace, {k: target[k] for k in ("model", "page", "winner")}], sort_keys=True
        ).encode()
    ).hexdigest()
    return key, os.path.join(root, "postdesk", "handoffs", key + ".json")


def export_once(
    drive, journal: str, parent: str, winner: str, files: list[tuple[str, str]]
) -> dict:
    segment(winner)
    with locked(journal):
        record = load(journal)
        if record and (record["parent"] != parent or record["winner"] != winner):
            raise ValueError("Export destination changed; refusing to reroute a started export")
        if not record:
            record = {"parent": parent, "winner": winner, "folder_id": None, "files": {}}
            save(journal, record)
        if not record["folder_id"]:
            matches = [f for f in drive.list_files(parent) if f.name == winner]
            if matches:
                if len(matches) != 1 or not matches[0].is_folder:
                    raise ValueError("Ambiguous winner folder")
                record["folder_id"] = matches[0].id
            else:
                if record.get("creating"):
                    raise ValueError("Winner folder creation uncertain; reconcile before retry")
                record["creating"] = True
                save(journal, record)
                record["folder_id"] = drive.create_folder(winner, parent)
            if not record["folder_id"] or record["folder_id"] == parent:
                raise ValueError("Refusing parent-folder export")
            save(journal, record)
        for name, path in files:
            segment(name)
            with open(path, "rb") as f:
                digest = hashlib.file_digest(f, "sha256").hexdigest()
            previous = record["files"].get(name)
            if previous:
                if previous["digest"] != digest:
                    raise ValueError("Export content changed for an existing filename")
                if previous.get("drive_id"):
                    continue
                raise ValueError("Upload outcome uncertain; reconcile before retry")
            if any(f.name == name for f in drive.list_files(record["folder_id"])):
                raise ValueError("Existing output name has no receipt; reconcile before retry")
            record["files"][name] = {"digest": digest, "drive_id": None}
            save(journal, record)
            fid = drive.upload(path, record["folder_id"], name=name)
            if not fid:
                raise ValueError("Upload outcome uncertain; no file ID returned")
            record["files"][name]["drive_id"] = fid
            save(journal, record)
        return record


def export_job(drive, store, job) -> dict:
    target = job.postdesk_target
    if not target:
        return {}
    if len(job.sources) != 1:
        raise ValueError("Winner jobs require one source")
    source = job.sources[0]
    files = []
    for variant in source.variants:
        if variant.status != "ok":
            continue
        path = store.find_variant(source.source_id, variant.filename)
        if path is None:
            raise ValueError("Rendered winner file is missing")
        files.append((f"{source.source_id}_v{variant.index:03d}.mp4", path))
    if not files:
        raise ValueError("No approved winner variants to export")
    journal = os.path.join(store._ws.job_dir(job.job_id), "postdesk-export.json")
    return export_once(drive, journal, target["folder_id"], target["winner"], files)


def claim_winner(
    root: str, parent: str, winner: str, source_identity: str, *, owner: str | None = None
) -> None:
    """One source per winner folder, including across workflows and handoffs."""
    owner = owner or source_identity
    key = hashlib.sha256(json.dumps([parent, winner]).encode()).hexdigest()
    path = os.path.join(root, "postdesk", "winner-claims", key + ".json")
    with locked(path):
        claim = load(path)
        if claim and (claim.get("source") != source_identity or claim.get("owner") != owner):
            raise ValueError("This winner folder is already assigned to another source or workflow")
        if not claim:
            save(path, {"source": source_identity, "owner": owner})


def workflow_submission(store, workflow_id: str, source_hash: str, payload: dict, create):
    """Intent survives a crash before the workflow ledger receives the job ID."""
    key = hashlib.sha256(json.dumps([workflow_id, source_hash]).encode()).hexdigest()
    path = os.path.join(store._ws.root, "postdesk", "workflow-submissions", key + ".json")
    with locked(path):
        record = load(path)
        if record and record["payload"] != payload:
            raise ValueError("Winner submission conflicts with the original workflow request")
        found = next(
            (j for j in store.list() if (j.postdesk_target or {}).get("workflow_operation") == key),
            None,
        )
        if found:
            job = found
        elif record:
            raise ValueError(
                "Workflow submission outcome needs review; no duplicate render started"
            )
        else:
            save(path, {"payload": payload, "submitting": True})
            job = create(key)
        save(path, {"payload": payload, "job_id": job.job_id})
        return job
