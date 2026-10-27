"""In-memory FakeDrive for farm tests — backed by REAL local files.

Faithful enough to test the runner end-to-end: downloads produce real bytes the engine
can probe/render, and uploads are stored so we can assert on what landed where.
"""
from __future__ import annotations

import hashlib
import itertools
import os
import shutil
import tempfile
import threading

from variant_maker.farm.drive import FOLDER_MIME, DriveClient, DriveFile


class FakeDrive(DriveClient):
    def __init__(self):
        self._ids = (f"id{n}" for n in itertools.count(1))
        # id -> node dict: {name, mime_type, parent, blob_path|None}
        self._nodes: dict[str, dict] = {}
        self._store = tempfile.mkdtemp(prefix="fakedrive_")
        self._lock = threading.Lock()

    # ---- test setup helpers ----
    def make_folder(self, name: str, parent: str | None = None) -> str:
        with self._lock:
            fid = next(self._ids)
            self._nodes[fid] = {"name": name, "mime_type": FOLDER_MIME, "parent": parent, "blob": None}
            return fid

    def put_file(self, name: str, local_path: str, parent: str, mime_type: str = "video/mp4") -> str:
        return self._store_file(name, local_path, parent, mime_type)

    # ---- DriveClient interface ----
    def list_files(self, folder_id: str) -> list[DriveFile]:
        with self._lock:
            items = list(self._nodes.items())
        out = []
        for fid, n in items:
            if n["parent"] != folder_id:
                continue
            md5 = self._md5(n["blob"]) if n["blob"] else None
            out.append(DriveFile(id=fid, name=n["name"], mime_type=n["mime_type"], md5=md5, parents=(n["parent"],) if n["parent"] else ()))
        return out

    def download(self, file_id: str, dest_path: str) -> None:
        node = self._nodes[file_id]
        if node["blob"] is None:
            raise IsADirectoryError(f"{file_id} is a folder")
        shutil.copyfile(node["blob"], dest_path)

    def create_folder(self, name: str, parent_id: str) -> str:
        return self.make_folder(name, parent_id)

    def find_folder(self, name: str, parent_id: str) -> str | None:
        for fid, n in self._nodes.items():
            if n["parent"] == parent_id and n["mime_type"] == FOLDER_MIME and n["name"] == name:
                return fid
        return None

    def upload(self, local_path: str, parent_id: str, name: str | None = None) -> str:
        return self._store_file(name or os.path.basename(local_path), local_path, parent_id,
                                "application/octet-stream")

    def get_file(self, file_id: str) -> DriveFile:
        n = self._nodes[file_id]  # KeyError if missing
        md5 = self._md5(n["blob"]) if n["blob"] else None
        return DriveFile(id=file_id, name=n["name"], mime_type=n["mime_type"], md5=md5, parents=(n["parent"],) if n["parent"] else ())

    def trash(self, file_id: str) -> None:
        del self._nodes[file_id]

    # ---- internals ----
    def _store_file(self, name: str, local_path: str, parent: str, mime_type: str) -> str:
        with self._lock:
            fid = next(self._ids)
            blob = os.path.join(self._store, fid)
            shutil.copyfile(local_path, blob)
            self._nodes[fid] = {"name": name, "mime_type": mime_type, "parent": parent, "blob": blob}
            return fid

    @staticmethod
    def _md5(path: str) -> str:
        h = hashlib.md5()
        with open(path, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
        return h.hexdigest()
