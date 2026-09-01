"""Caption bank for Drive export filenames (Repurpose.io uses the name as the post)."""
from __future__ import annotations

import json
import os
import re
import secrets
import tempfile
import threading
from dataclasses import asdict, dataclass

MAX_STEM = 240
_ILLEGAL = re.compile(r"[/\\\x00-\x1f]")
_DASH_SPLIT = re.compile(r"(?m)^\s*---\s*$")
INTERNAL_INDEX_RE = re.compile(
    r"(?im)^(?:copy|take)\s+\d+\s+of\s+\d+\s*(?:[—–-].*)?$"
)


class CaptionError(Exception):
    """Raised on an empty or malformed caption."""


@dataclass
class Caption:
    id: str
    text: str


def split_caption_bank(raw: str) -> list[str]:
    """One caption per block. Prefers a --- line; else blank lines (ChatGPT paste)."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[^\n]*\n", "", text)
        text = re.sub(r"\n```\s*$", "", text)
    if _DASH_SPLIT.search(text):
        parts = _DASH_SPLIT.split(text)
    else:
        parts = re.split(r"\n\s*\n", text)
    out: list[str] = []
    for part in parts:
        block = part.strip()
        block = re.sub(r"^(?:\d+[.)]\s+|[-*]\s+)", "", block)
        if block:
            out.append(block)
    return out


def strip_internal_index_lines(text: str) -> str:
    """Drop 'Copy 1 of 20' / 'Take 2 of 8' lines so they never hit Drive filenames."""
    lines = [ln for ln in (text or "").splitlines() if not INTERNAL_INDEX_RE.match(ln.strip())]
    return "\n".join(lines).strip()


def sanitize_caption_stem(text: str) -> str:
    """Drive-safe filename stem. Keeps hashtags/emoji; strips path chars and newlines."""
    cleaned = strip_internal_index_lines(text or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = cleaned.replace("\n", " ")
    cleaned = _ILLEGAL.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if cleaned.lower().endswith(".mp4"):
        cleaned = cleaned[:-4].rstrip(" .")
    if len(cleaned) > MAX_STEM:
        cleaned = cleaned[:MAX_STEM].rstrip(" .")
    return cleaned


def caption_filename(caption: str | None, fallback: str) -> str:
    stem = sanitize_caption_stem(caption or "")
    if not stem:
        return fallback
    return f"{stem}.mp4"


DEFAULT_BANK_ID = "bank_generic"
DEFAULT_BANK_NAME = "Generic"
LOW_CAPTION_PACK = 20


@dataclass
class CaptionBankMeta:
    id: str
    name: str
    is_default: bool
    count: int
    remaining: int
    cursor: int

    @property
    def low(self) -> bool:
        """True when a 20-variant pack would repeat or the folder is empty."""
        return self.count == 0 or self.remaining < LOW_CAPTION_PACK


def _parse_items(raw_items: object) -> list[Caption]:
    items: list[Caption] = []
    for item in raw_items or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "")
        text = str(item.get("text") or "").strip()
        if cid and text:
            items.append(Caption(id=cid, text=text))
    return items


def _fresh_generic() -> dict:
    return {
        "id": DEFAULT_BANK_ID,
        "name": DEFAULT_BANK_NAME,
        "cursor": 0,
        "items": [],
    }


class CaptionStore:
    """Named caption folders (Generic default) with a per-folder round-robin cursor."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()

    def list_banks(self) -> list[CaptionBankMeta]:
        data = self._load()
        return [self._meta(b, data["default_id"]) for b in data["banks"]]

    def bank_meta(self, bank_id: str | None = None) -> CaptionBankMeta:
        data = self._load()
        bank = self._bank(data, bank_id)
        return self._meta(bank, data["default_id"])

    def default_id(self) -> str:
        return str(self._load()["default_id"])

    def list(self, bank_id: str | None = None) -> list[Caption]:
        return list(self._bank(self._load(), bank_id)["items"])

    def cursor(self, bank_id: str | None = None) -> int:
        return int(self._bank(self._load(), bank_id)["cursor"])

    def create_bank(self, name: str) -> CaptionBankMeta:
        label = (name or "").strip()
        if not label:
            raise CaptionError("folder name is required")
        with self._lock:
            data = self._load()
            bank = {
                "id": f"bank_{secrets.token_hex(6)}",
                "name": label,
                "cursor": 0,
                "items": [],
            }
            data["banks"].append(bank)
            self._save(data)
            return self._meta(bank, data["default_id"])

    def rename_bank(self, bank_id: str, name: str) -> CaptionBankMeta | None:
        label = (name or "").strip()
        if not label:
            raise CaptionError("folder name is required")
        with self._lock:
            data = self._load()
            bank = self._find(data, bank_id)
            if bank is None:
                return None
            bank["name"] = label
            self._save(data)
            return self._meta(bank, data["default_id"])

    def delete_bank(self, bank_id: str) -> bool:
        with self._lock:
            data = self._load()
            if bank_id == data["default_id"] or bank_id == DEFAULT_BANK_ID:
                raise CaptionError("cannot delete the Generic folder")
            before = len(data["banks"])
            data["banks"] = [b for b in data["banks"] if b["id"] != bank_id]
            if len(data["banks"]) == before:
                return False
            self._save(data)
            return True

    def add(self, text: str, bank_id: str | None = None) -> Caption:
        body = (text or "").strip()
        if not body:
            raise CaptionError("caption text is required")
        with self._lock:
            data = self._load()
            bank = self._bank(data, bank_id)
            cap = Caption(id=f"cap_{secrets.token_hex(6)}", text=body)
            bank["items"].append(cap)
            self._save(data)
            return cap

    def add_many(self, texts: list[str], bank_id: str | None = None) -> list[Caption]:
        bodies = [t.strip() for t in texts if (t or "").strip()]
        if not bodies:
            raise CaptionError("no captions to add")
        with self._lock:
            data = self._load()
            bank = self._bank(data, bank_id)
            out: list[Caption] = []
            for body in bodies:
                cap = Caption(id=f"cap_{secrets.token_hex(6)}", text=body)
                bank["items"].append(cap)
                out.append(cap)
            self._save(data)
            return out

    def update(self, caption_id: str, text: str) -> Caption | None:
        body = (text or "").strip()
        if not body:
            raise CaptionError("caption text is required")
        with self._lock:
            data = self._load()
            for bank in data["banks"]:
                for i, cap in enumerate(bank["items"]):
                    if cap.id != caption_id:
                        continue
                    updated = Caption(id=cap.id, text=body)
                    bank["items"][i] = updated
                    self._save(data)
                    return updated
            return None

    def delete(self, caption_id: str) -> bool:
        with self._lock:
            data = self._load()
            for bank in data["banks"]:
                remaining = [c for c in bank["items"] if c.id != caption_id]
                if len(remaining) == len(bank["items"]):
                    continue
                bank["items"] = remaining
                n = len(remaining)
                bank["cursor"] = 0 if n == 0 else int(bank["cursor"]) % n
                self._save(data)
                return True
            return False

    def peek(self, n: int, bank_id: str | None = None) -> list[str]:
        if n <= 0:
            return []
        bank = self._bank(self._load(), bank_id)
        texts = [c.text for c in bank["items"]]
        if not texts:
            return []
        start = int(bank["cursor"]) % len(texts)
        return [texts[(start + i) % len(texts)] for i in range(n)]

    def take(self, n: int, bank_id: str | None = None) -> list[str]:
        if n <= 0:
            return []
        with self._lock:
            data = self._load()
            bank = self._bank(data, bank_id)
            texts = [c.text for c in bank["items"]]
            if not texts:
                return []
            start = int(bank["cursor"]) % len(texts)
            out = [texts[(start + i) % len(texts)] for i in range(n)]
            bank["cursor"] = (start + n) % len(texts)
            self._save(data)
            return out

    def advance(self, n: int, bank_id: str | None = None) -> int:
        if n <= 0:
            return self.cursor(bank_id)
        with self._lock:
            data = self._load()
            bank = self._bank(data, bank_id)
            count = len(bank["items"])
            if count == 0:
                bank["cursor"] = 0
            else:
                bank["cursor"] = (int(bank["cursor"]) + n) % count
            self._save(data)
            return int(bank["cursor"])

    def _meta(self, bank: dict, default_id: str) -> CaptionBankMeta:
        items = bank["items"]
        cursor = int(bank["cursor"] or 0)
        count = len(items)
        remaining = 0 if count == 0 else max(0, count - cursor)
        return CaptionBankMeta(
            id=str(bank["id"]),
            name=str(bank["name"]),
            is_default=str(bank["id"]) == default_id,
            count=count,
            remaining=remaining,
            cursor=cursor,
        )

    def _find(self, data: dict, bank_id: str | None) -> dict | None:
        wanted = (bank_id or "").strip() or data["default_id"]
        for bank in data["banks"]:
            if bank["id"] == wanted:
                return bank
        return None

    def _bank(self, data: dict, bank_id: str | None) -> dict:
        found = self._find(data, bank_id)
        if found is not None:
            return found
        for bank in data["banks"]:
            if bank["id"] == data["default_id"]:
                return bank
        return data["banks"][0]

    def _load(self) -> dict:
        empty = {
            "default_id": DEFAULT_BANK_ID,
            "banks": [_fresh_generic()],
        }
        if not os.path.exists(self._path):
            return empty
        try:
            with open(self._path, encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, json.JSONDecodeError):
            return empty
        if not isinstance(raw, dict):
            return empty
        if "banks" not in raw:
            items = _parse_items(raw.get("items"))
            cursor = int(raw.get("cursor") or 0)
            if items:
                cursor %= len(items)
            else:
                cursor = 0
            return {
                "default_id": DEFAULT_BANK_ID,
                "banks": [{
                    "id": DEFAULT_BANK_ID,
                    "name": DEFAULT_BANK_NAME,
                    "cursor": cursor,
                    "items": items,
                }],
            }
        banks: list[dict] = []
        for entry in raw.get("banks") or []:
            if not isinstance(entry, dict):
                continue
            bid = str(entry.get("id") or "")
            name = str(entry.get("name") or "").strip() or DEFAULT_BANK_NAME
            if not bid:
                continue
            items = _parse_items(entry.get("items"))
            cursor = int(entry.get("cursor") or 0)
            cursor = 0 if not items else cursor % len(items)
            banks.append({"id": bid, "name": name, "cursor": cursor, "items": items})
        if not banks:
            return empty
        default_id = str(raw.get("default_id") or DEFAULT_BANK_ID)
        if not any(b["id"] == default_id for b in banks):
            default_id = banks[0]["id"]
        return {"default_id": default_id, "banks": banks}

    def _save(self, data: dict) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        payload = {
            "default_id": data["default_id"],
            "banks": [
                {
                    "id": b["id"],
                    "name": b["name"],
                    "cursor": int(b.get("cursor") or 0),
                    "items": [asdict(c) for c in b.get("items") or []],
                }
                for b in data.get("banks") or []
            ],
        }
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(self._path) or ".", prefix=".captions-", suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            os.replace(tmp_path, self._path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
