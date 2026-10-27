"""The ONLY Google-aware module, behind a small interface.

`DriveClient` is the seam: the runner is written against it and tested with an in-memory
FakeDrive (see tests/), so no real Google is touched in tests. The real `GoogleDrive`
adapter lazy-imports the google libs (the optional [farm] extra) so the engine stays light.
"""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

FOLDER_MIME = "application/vnd.google-apps.folder"
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


@dataclass(frozen=True)
class DriveFile:
    id: str
    name: str
    mime_type: str
    md5: str | None = None  # Drive's content checksum; cheap dedup signal without download
    parents: tuple[str, ...] = ()

    @property
    def is_folder(self) -> bool:
        return self.mime_type == FOLDER_MIME


def is_video_file(f: DriveFile) -> bool:
    """Direct-child video? Folders never; video/* mime or a known video extension."""
    if f.is_folder:
        return False
    if (f.mime_type or "").startswith("video/"):
        return True
    return os.path.splitext(f.name)[1].lower() in VIDEO_EXTS


class DriveClient(ABC):
    """List / download / create-folder / find-folder / upload. The whole Drive surface."""

    @abstractmethod
    def list_files(self, folder_id: str) -> list[DriveFile]:
        """Direct (non-recursive) children of `folder_id`, excluding trashed items."""

    @abstractmethod
    def download(self, file_id: str, dest_path: str) -> None:
        """Download `file_id`'s bytes to `dest_path`."""

    @abstractmethod
    def create_folder(self, name: str, parent_id: str) -> str:
        """Create a subfolder and return its id."""

    @abstractmethod
    def find_folder(self, name: str, parent_id: str) -> str | None:
        """Id of an existing child folder named `name`, else None (idempotent output dirs)."""

    @abstractmethod
    def upload(self, local_path: str, parent_id: str, name: str | None = None) -> str:
        """Upload a local file into `parent_id`; return the new file id."""

    @abstractmethod
    def get_file(self, file_id: str) -> DriveFile:
        """Metadata for one file/folder id."""

    @abstractmethod
    def trash(self, file_id: str) -> None:
        """Trash (or permanently delete) `file_id` so it no longer appears in list_files."""

    def find_or_create_folder(self, name: str, parent_id: str) -> str:
        """Idempotent: reuse a same-named child folder, else create one."""
        existing = self.find_folder(name, parent_id)
        return existing if existing is not None else self.create_folder(name, parent_id)


# ---- Real adapter (lazy google imports) ------------------------------------

def _to_drive_file(res: dict) -> DriveFile:
    """PURE: map a Drive `files` resource dict to a DriveFile (unit-tested, no API)."""
    return DriveFile(
        id=res["id"],
        name=res["name"],
        mime_type=res.get("mimeType", ""),
        md5=res.get("md5Checksum"),
        parents=tuple(res.get("parents", [])),
    )


def _list_query(folder_id: str) -> str:
    """PURE: the Drive query string for untrashed direct children of a folder."""
    return f"'{folder_id}' in parents and trashed = false"


_FIELDS = "nextPageToken, files(id, name, mimeType, md5Checksum)"


SCOPES = ["https://www.googleapis.com/auth/drive"]


class GoogleDrive(DriveClient):
    """Real Drive. Two auth methods: a service-account JSON key, or an OAuth user token
    (`token.json` from a one-time sign-in — the no-downloadable-key path for orgs that block
    service-account keys). `service` is injectable for testing; real creds need the [farm]
    extra and are built lazily."""

    def __init__(self, service_account_json: str | None = None, *,
                 oauth_token: str | None = None, service=None):
        self._service = service
        self._sa_json = service_account_json
        self._oauth_token = oauth_token

    @classmethod
    def from_auth(cls, auth, *, service=None) -> "GoogleDrive":
        return cls(service_account_json=auth.service_account_json,
                   oauth_token=auth.oauth_token, service=service)

    @property
    def auth_method(self) -> str | None:
        if self._oauth_token:
            return "oauth"
        if self._sa_json:
            return "service_account"
        return None

    @property
    def service(self):
        if self._service is None:
            self._service = self._build_service()
        return self._service

    def _build_service(self):
        if self._oauth_token:
            return self._build_oauth(self._oauth_token)
        if self._sa_json:
            return self._build_service_account(self._sa_json)
        raise ValueError("GoogleDrive needs a service_account_json or oauth_token")

    @staticmethod
    def _build_service_account(sa_json: str):  # pragma: no cover - needs google libs + creds
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_file(sa_json, scopes=SCOPES)
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    @staticmethod
    def _build_oauth(token_path: str):  # pragma: no cover - needs google libs + a token
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        if not creds.valid and creds.refresh_token:
            creds.refresh(Request())  # long-lived refresh token keeps the worker headless
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    def list_files(self, folder_id: str) -> list[DriveFile]:
        files, token = [], None
        while True:
            resp = self.service.files().list(
                q=_list_query(folder_id), fields=_FIELDS, pageToken=token,
                pageSize=1000, supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            files.extend(_to_drive_file(r) for r in resp.get("files", []))
            token = resp.get("nextPageToken")
            if not token:
                return files

    def download(self, file_id: str, dest_path: str) -> None:  # pragma: no cover - needs google libs
        from googleapiclient.http import MediaIoBaseDownload

        req = self.service.files().get_media(fileId=file_id, supportsAllDrives=True)
        with open(dest_path, "wb") as fh:
            dl = MediaIoBaseDownload(fh, req)
            done = False
            while not done:
                _, done = dl.next_chunk()

    def create_folder(self, name: str, parent_id: str) -> str:
        meta = {"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]}
        res = self.service.files().create(body=meta, fields="id", supportsAllDrives=True).execute()
        return res["id"]

    def find_folder(self, name: str, parent_id: str) -> str | None:
        q = (f"{_list_query(parent_id)} and mimeType = '{FOLDER_MIME}' "
             f"and name = '{name}'")
        resp = self.service.files().list(
            q=q, fields="files(id)", pageSize=1, supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        files = resp.get("files", [])
        return files[0]["id"] if files else None

    def upload(self, local_path: str, parent_id: str, name: str | None = None) -> str:  # pragma: no cover - needs google libs
        import os

        from googleapiclient.http import MediaFileUpload

        meta = {"name": name or os.path.basename(local_path), "parents": [parent_id]}
        media = MediaFileUpload(local_path, resumable=True)
        res = self.service.files().create(
            body=meta, media_body=media, fields="id", supportsAllDrives=True
        ).execute()
        return res["id"]

    def get_file(self, file_id: str) -> DriveFile:
        res = self.service.files().get(
            fileId=file_id, fields="id, name, mimeType, md5Checksum, parents",
            supportsAllDrives=True,
        ).execute()
        return _to_drive_file(res)

    def trash(self, file_id: str) -> None:  # pragma: no cover - needs google libs
        self.service.files().update(
            fileId=file_id, body={"trashed": True}, supportsAllDrives=True,
        ).execute()
