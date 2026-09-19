"""Workspace-local Gallery folders. Labels for packs — not Google Drive folders."""
from __future__ import annotations

import json
import os
import secrets
import tempfile
import threading
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

MAX_NAME = 64


class GalleryFolderError(Exception):
    """Raised when a folder name is empty, too long, or already used."""


@dataclass
class GalleryFolder:
    id: str
    name: str
    created_utc: str


def _now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_folder_name(raw: str) -> str:
    name = " ".join((raw or "").split())
    if not name:
        raise GalleryFolderError("Folder name is required.")
    if len(name) > MAX_NAME:
        raise GalleryFolderError(f"Folder name must be {MAX_NAME} characters or fewer.")
    return name


class GalleryFolderStore:
    """JSON file: folder list + source_id → folder_id assignments."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()

    def list(self) -> list[GalleryFolder]:
        return list(self._load()["folders"])

    def get(self, folder_id: str) -> GalleryFolder | None:
        for folder in self.list():
            if folder.id == folder_id:
                return folder
        return None

    def create(self, name: str) -> GalleryFolder:
        clean = normalize_folder_name(name)
        with self._lock:
            data = self._load()
            self._reject_duplicate(data["folders"], clean)
            folder = GalleryFolder(
                id=f"gf_{secrets.token_hex(6)}",
                name=clean,
                created_utc=_now(),
            )
            data["folders"].append(folder)
            self._save(data)
            return folder

    def rename(self, folder_id: str, name: str) -> GalleryFolder | None:
        clean = normalize_folder_name(name)
        with self._lock:
            data = self._load()
            for i, folder in enumerate(data["folders"]):
                if folder.id != folder_id:
                    continue
                self._reject_duplicate(data["folders"], clean, skip_id=folder_id)
                updated = GalleryFolder(
                    id=folder.id, name=clean, created_utc=folder.created_utc,
                )
                data["folders"][i] = updated
                self._save(data)
                return updated
            return None

    def delete(self, folder_id: str) -> bool:
        with self._lock:
            data = self._load()
            remaining = [f for f in data["folders"] if f.id != folder_id]
            if len(remaining) == len(data["folders"]):
                return False
            data["folders"] = remaining
            data["assignments"] = {
                sid: fid for sid, fid in data["assignments"].items() if fid != folder_id
            }
            self._save(data)
            return True

    def assignment(self, source_id: str) -> str | None:
        fid = self._load()["assignments"].get(source_id)
        return fid if isinstance(fid, str) and fid else None

    def assign(self, source_id: str, folder_id: str | None) -> None:
        sid = (source_id or "").strip()
        if not sid:
            raise GalleryFolderError("source_id is required.")
        with self._lock:
            data = self._load()
            if folder_id:
                if not any(f.id == folder_id for f in data["folders"]):
                    raise GalleryFolderError("folder not found")
                data["assignments"][sid] = folder_id
            else:
                data["assignments"].pop(sid, None)
            self._save(data)

    def unassign(self, source_id: str) -> None:
        with self._lock:
            data = self._load()
            if source_id not in data["assignments"]:
                return
            data["assignments"].pop(source_id, None)
            self._save(data)

    def prune(self, known_source_ids: set[str]) -> None:
        with self._lock:
            data = self._load()
            kept = {
                sid: fid
                for sid, fid in data["assignments"].items()
                if sid in known_source_ids
            }
            if kept == data["assignments"]:
                return
            data["assignments"] = kept
            self._save(data)

    def overview(self, source_ids: set[str]) -> tuple[list[tuple[GalleryFolder, int]], int]:
        self.prune(source_ids)
        folders = self.list()
        counts = {f.id: 0 for f in folders}
        assigned = self._load()["assignments"]
        unassigned = 0
        for sid in source_ids:
            fid = assigned.get(sid)
            if fid in counts:
                counts[fid] += 1
            else:
                unassigned += 1
        return [(f, counts[f.id]) for f in folders], unassigned

    def _reject_duplicate(
        self, folders: list[GalleryFolder], name: str, *, skip_id: str | None = None,
    ) -> None:
        key = name.casefold()
        for folder in folders:
            if skip_id and folder.id == skip_id:
                continue
            if folder.name.casefold() == key:
                raise GalleryFolderError("A folder with that name already exists.")

    def _load(self) -> dict:
        empty: dict = {"folders": [], "assignments": {}}
        if not os.path.exists(self._path):
            return empty
        with open(self._path, encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            return empty
        folders: list[GalleryFolder] = []
        for item in raw.get("folders") or []:
            if not isinstance(item, dict):
                continue
            fid = str(item.get("id") or "")
            name = str(item.get("name") or "").strip()
            created = str(item.get("created_utc") or "")
            if fid and name:
                folders.append(GalleryFolder(id=fid, name=name, created_utc=created))
        assignments: dict[str, str] = {}
        raw_asg = raw.get("assignments")
        if isinstance(raw_asg, dict):
            for sid, fid in raw_asg.items():
                if isinstance(sid, str) and isinstance(fid, str) and sid and fid:
                    assignments[sid] = fid
        return {"folders": folders, "assignments": assignments}

    def _save(self, data: dict) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(self._path) or ".",
            prefix=".gallery-folders-",
            suffix=".tmp",
        )
        payload = {
            "folders": [asdict(f) for f in data["folders"]],
            "assignments": data["assignments"],
        }
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            os.replace(tmp_path, self._path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
