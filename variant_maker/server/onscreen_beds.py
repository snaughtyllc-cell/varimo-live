"""Workspace sound beds for on-screen packs.

A bed is a file the user uploaded. Fresh uploads are copied onto a workspace
key. Saved setups point at that key, so a later clip can reuse the same sound.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import uuid

MAX_BED_BYTES = 20 * 1024 * 1024
MAX_SOUND_VIDEO_BYTES = 1024 * 1024 * 1024
_AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"}
_VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
_AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}
_LOCK = threading.Lock()


class BedError(ValueError):
    pass


def _registry_path(root: str) -> str:
    return os.path.join(root, "onscreen_beds.json")


def _local_get_errors() -> tuple[type[BaseException], ...]:
    """Download failures that should leave the durable bed and skip the cache."""
    try:
        from botocore.exceptions import BotoCoreError
    except ImportError:
        return (OSError, RuntimeError)
    return (OSError, RuntimeError, BotoCoreError)


def _load(root: str) -> dict:
    path = _registry_path(root)
    if not os.path.isfile(path):
        return {"beds": []}
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"beds": []}
    if not isinstance(data, dict):
        return {"beds": []}
    beds = data.get("beds")
    data["beds"] = beds if isinstance(beds, list) else []
    return data


def _save(root: str, data: dict) -> None:
    os.makedirs(root, exist_ok=True)
    path = _registry_path(root)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)


def lookup(root: str, *, bed_id: str | None = None, key: str | None = None) -> dict | None:
    with _LOCK:
        beds = list(_load(root).get("beds") or [])
    for row in beds:
        if not isinstance(row, dict):
            continue
        if bed_id and row.get("id") == bed_id:
            return dict(row)
        if key and row.get("key") == key:
            return dict(row)
    return None


def _remember(root: str, row: dict) -> None:
    with _LOCK:
        data = _load(root)
        beds = [b for b in data["beds"] if isinstance(b, dict) and b.get("id") != row["id"]]
        beds.append(row)
        data["beds"] = beds[-200:]
        _save(root, data)


def _under_root(root: str, path: str) -> bool:
    root_real = os.path.realpath(root)
    path_real = os.path.realpath(path)
    return path_real == root_real or path_real.startswith(root_real + os.sep)


def _safe_token(value: str, name: str) -> str:
    raw = str(value or "").strip()
    if (
        not raw
        or raw in (".", "..")
        or "/" in raw
        or "\\" in raw
        or "\x00" in raw
        or raw != os.path.basename(raw)
    ):
        raise BedError(f"invalid {name}")
    return raw


def is_direct_upload_key(key: str) -> bool:
    """True only for uploads/{id}/{basename} — never inputs/ or outputs/."""
    parts = str(key or "").split("/")
    if len(parts) != 3 or parts[0] != "uploads":
        return False
    upload_id, name = parts[1], parts[2]
    if not upload_id or upload_id != os.path.basename(upload_id) or upload_id in (".", ".."):
        return False
    return bool(name) and name == os.path.basename(name) and name not in (".", "..")


def bed_object_key(workspace_id: str | None, bed_id: str, filename: str) -> str:
    name = os.path.basename(filename) or "sound.m4a"
    bid = _safe_token(bed_id, "bed_id")
    if workspace_id:
        tenant = _safe_token(str(workspace_id), "workspace_id")
        return f"tenants/{tenant}/beds/{bid}/{name}"
    return f"beds/{bid}/{name}"


def is_owned_bed_key(key: str, workspace_id: str | None) -> bool:
    raw = str(key or "")
    if not raw or ".." in raw.split("/") or raw.startswith("/") or "\\" in raw:
        return False
    if workspace_id:
        return raw.startswith(f"tenants/{workspace_id}/beds/")
    return raw.startswith("beds/")


def _ext_ok(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in _AUDIO_EXT


def _is_video(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in _VIDEO_EXT


def source_byte_limit(name: str) -> int:
    return MAX_SOUND_VIDEO_BYTES if _is_video(name) else MAX_BED_BYTES


def source_too_big_detail(name: str) -> str:
    if _is_video(name):
        return "That video is too big."
    return "Sound files stay under 20 MB."


def audio_media_type(name: str) -> str:
    return _AUDIO_TYPES.get(os.path.splitext(name)[1].lower(), "audio/mpeg")


def _stored_name(filename: str) -> str:
    base = os.path.basename(filename) or "sound.m4a"
    if not _is_video(base):
        return base
    stem = os.path.splitext(base)[0] or "sound"
    return f"{stem}.m4a"


def pull_audio(src: str, dest: str) -> None:
    """Keep the soundtrack and drop the picture."""
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", src,
        ],
        check=False, capture_output=True, text=True,
    )
    heard = probe.stdout or ""
    if probe.returncode != 0 and "audio" not in heard:
        raise BedError("Could not use the sound from that video.")
    if "audio" not in heard:
        raise BedError("That video has no sound.")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error", "-i", src, "-vn",
                "-c:a", "aac", "-b:a", "160k", dest,
            ],
            check=True, capture_output=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        if os.path.exists(dest):
            os.remove(dest)
        raise BedError("Could not use the sound from that video.") from exc
    if not os.path.isfile(dest) or os.path.getsize(dest) <= 0:
        raise BedError("That video has no sound.")


def _local_path(root: str, bed_id: str, filename: str) -> str:
    folder = os.path.join(root, "beds", bed_id)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, os.path.basename(filename) or "sound.m4a")


def resolve_bed_file(root: str, audio: dict, object_store, dest_dir: str) -> str:
    """Return a local file for this sound. Missing beds are an error."""
    bed_id = str((audio or {}).get("bed_id") or "")
    row = lookup(root, bed_id=bed_id) if bed_id else None
    if row is None:
        key = str((audio or {}).get("key") or "")
        row = lookup(root, key=key) if key else None
    if row is None:
        raise BedError("A sound on this setup is missing.")
    path = row.get("path")
    if isinstance(path, str) and os.path.isfile(path) and _under_root(root, path):
        return path
    key = row.get("key")
    if not key or object_store is None:
        raise BedError("A sound on this setup is missing.")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(str(key)) or "sound.m4a")
    object_store.get(key, dest)
    if not os.path.isfile(dest) or os.path.getsize(dest) <= 0:
        raise BedError("A sound on this setup is missing.")
    return dest


def _row_from_known(base: dict, known: dict) -> dict:
    base["bed_id"] = known.get("id") or known.get("bed_id")
    if known.get("key"):
        base["key"] = known["key"]
    return base


def retain_project(
    project: dict | None,
    *,
    root: str,
    workspace_id: str | None,
    object_store,
    claim_upload,
    files: dict[str, str],
    cache: dict | None = None,
) -> dict | None:
    """Copy fresh uploads onto workspace beds. Reject keys this workspace does not own."""
    if not isinstance(project, dict):
        return project
    project = json.loads(json.dumps(project))
    seen = cache if cache is not None else {}

    def base_of(raw: dict) -> dict:
        name = (str(raw.get("name") or "Sound").strip() or "Sound")[:80]
        row = {"name": name}
        for field in ("volume", "mode", "start", "id"):
            if field in raw:
                row[field] = raw[field]
        return row

    def ingest_bytes(raw: dict, src: str, filename: str, cache_key: str) -> dict:
        video = _is_video(filename)
        if not video and not _ext_ok(filename):
            raise BedError("Sounds need to be audio files.")
        if os.path.getsize(src) > source_byte_limit(filename):
            raise BedError(source_too_big_detail(filename))
        bed_id = uuid.uuid4().hex[:12]
        stored = _stored_name(filename)
        dest = _local_path(root, bed_id, stored)
        if video:
            pull_audio(src, dest)
        elif os.path.realpath(src) != os.path.realpath(dest):
            shutil.copyfile(src, dest)
        durable = None
        if object_store is not None:
            durable = bed_object_key(workspace_id, bed_id, stored)
            object_store.put(durable, dest)
        _remember(root, {"id": bed_id, "name": raw.get("name") or filename, "key": durable, "path": dest})
        row = base_of(raw)
        row["bed_id"] = bed_id
        if durable:
            row["key"] = durable
        seen[cache_key] = {"bed_id": bed_id, "key": durable}
        return row

    def ingest_key(raw: dict, key: str) -> dict:
        filename = os.path.basename(key)
        video = _is_video(filename)
        if not video and not _ext_ok(filename):
            raise BedError("Sounds need to be audio files.")
        claim_upload(key)
        if object_store is None:
            raise BedError("That sound is not ready yet.")
        size = object_store.size(key) if hasattr(object_store, "size") else None
        if size is not None and int(size) > source_byte_limit(filename):
            raise BedError(source_too_big_detail(filename))
        bed_id = uuid.uuid4().hex[:12]
        stored = _stored_name(filename)
        durable = bed_object_key(workspace_id, bed_id, stored)
        local = _local_path(root, bed_id, stored)
        if video:
            src = local + ".src"
            try:
                object_store.get(key, src)
                pull_audio(src, local)
            finally:
                if os.path.exists(src):
                    os.remove(src)
            object_store.put(durable, local)
        else:
            copy = getattr(object_store, "copy", None)
            if callable(copy):
                copy(key, durable)
                try:
                    object_store.get(durable, local)
                except _local_get_errors():
                    local = None
            else:
                object_store.get(key, local)
                object_store.put(durable, local)
        _remember(root, {
            "id": bed_id,
            "name": raw.get("name") or filename,
            "key": durable,
            "path": local if local and os.path.isfile(local) else None,
        })
        row = base_of(raw)
        row["bed_id"] = bed_id
        row["key"] = durable
        seen[key] = {"bed_id": bed_id, "key": durable}
        return row

    def one(raw: dict) -> dict:
        row = base_of(raw)
        bed_id = str(raw.get("bed_id") or "").strip()
        key = str(raw.get("key") or "").strip()
        file_name = os.path.basename(str(raw.get("file") or ""))
        if key and key in seen:
            return _row_from_known(row, seen[key])
        if file_name and file_name in seen:
            return _row_from_known(row, seen[file_name])
        known = lookup(root, bed_id=bed_id) if bed_id else None
        if known is None and key and is_owned_bed_key(key, workspace_id):
            known = lookup(root, key=key)
        if known:
            return _row_from_known(row, known)
        if file_name and file_name in files:
            return ingest_bytes(raw, files[file_name], file_name, file_name)
        if key and is_direct_upload_key(key):
            return ingest_key(raw, key)
        raise BedError("That sound is not from this Studio.")

    def walk(item: dict) -> dict:
        audios = []
        for raw in list(item.get("audios") or [])[:4]:
            if isinstance(raw, dict) and (raw.get("key") or raw.get("bed_id") or raw.get("file")):
                audios.append(one(raw))
        if audios:
            item["audios"] = audios
        else:
            item.pop("audios", None)
        prints = []
        for child in list(item.get("prints") or [])[:5]:
            if isinstance(child, dict):
                prints.append(walk(child))
        if prints:
            item["prints"] = prints
        else:
            item.pop("prints", None)
        return item

    return walk(project)
