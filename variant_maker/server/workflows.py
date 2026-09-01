"""Named inbox→output Drive workflows. JSON-file CRUD, same style as destinations."""
from __future__ import annotations

import json
import os
import secrets
import tempfile
from dataclasses import asdict, dataclass

from variant_maker.server.runner import normalize_quality_mode

MAX_COUNT = 40
MIN_POLL_SECONDS = 30
MAX_POLL_SECONDS = 3600
DEFAULT_COUNT = 20
DEFAULT_POLL_SECONDS = 120


class WorkflowError(Exception):
    """Raised on a malformed workflow (bad count, unknown quality, missing name)."""


@dataclass
class Workflow:
    id: str
    name: str
    inbox_destination_id: str
    output_destination_id: str
    count: int = DEFAULT_COUNT
    quality_mode: str = "fast"
    allow_creative_escalate: bool = True
    enabled: bool = False
    poll_seconds: int = DEFAULT_POLL_SECONDS
    last_sweep_at: str | None = None
    last_summary: dict | None = None
    auto_caption: bool = False
    caption_bank_id: str = ""
    caption_from_filename: bool = False


def _validate(
    *,
    name: str,
    inbox_destination_id: str,
    output_destination_id: str,
    count: int,
    quality_mode: str,
    poll_seconds: int,
) -> tuple[str, str, str, int, str, int]:
    name = (name or "").strip()
    if not name:
        raise WorkflowError("name is required")
    inbox = (inbox_destination_id or "").strip()
    output = (output_destination_id or "").strip()
    if not inbox:
        raise WorkflowError("inbox_destination_id is required")
    if not output:
        raise WorkflowError("output_destination_id is required")
    if inbox == output:
        raise WorkflowError("inbox and output folders must be different")
    if not isinstance(count, int) or count < 1 or count > MAX_COUNT:
        raise WorkflowError(f"count must be 1–{MAX_COUNT}")
    quality = normalize_quality_mode(quality_mode)
    if not isinstance(poll_seconds, int) or poll_seconds < MIN_POLL_SECONDS or poll_seconds > MAX_POLL_SECONDS:
        raise WorkflowError(f"poll_seconds must be {MIN_POLL_SECONDS}–{MAX_POLL_SECONDS}")
    return name, inbox, output, count, quality, poll_seconds


class WorkflowStore:
    """JSON-file-backed CRUD for `Workflow`s."""

    def __init__(self, path: str) -> None:
        self._path = path

    def list(self) -> list[Workflow]:
        return self._load()

    def get(self, workflow_id: str) -> Workflow | None:
        for w in self._load():
            if w.id == workflow_id:
                return w
        return None

    def create(
        self,
        *,
        name: str,
        inbox_destination_id: str,
        output_destination_id: str,
        count: int = DEFAULT_COUNT,
        quality_mode: str = "fast",
        allow_creative_escalate: bool = True,
        enabled: bool = False,
        poll_seconds: int = DEFAULT_POLL_SECONDS,
        auto_caption: bool = False,
        caption_bank_id: str = "",
        caption_from_filename: bool = False,
    ) -> Workflow:
        name, inbox, output, count, quality, poll_seconds = _validate(
            name=name,
            inbox_destination_id=inbox_destination_id,
            output_destination_id=output_destination_id,
            count=count,
            quality_mode=quality_mode,
            poll_seconds=poll_seconds,
        )
        items = self._load()
        use_filename = bool(caption_from_filename)
        wf = Workflow(
            id=f"wf_{secrets.token_hex(6)}",
            name=name,
            inbox_destination_id=inbox,
            output_destination_id=output,
            count=count,
            quality_mode=quality,
            allow_creative_escalate=bool(allow_creative_escalate),
            enabled=bool(enabled),
            poll_seconds=poll_seconds,
            auto_caption=bool(auto_caption) and not use_filename,
            caption_bank_id=(caption_bank_id or "").strip(),
            caption_from_filename=use_filename,
        )
        items.append(wf)
        self._save(items)
        return wf

    def update(
        self,
        workflow_id: str,
        *,
        name: str | None = None,
        inbox_destination_id: str | None = None,
        output_destination_id: str | None = None,
        count: int | None = None,
        quality_mode: str | None = None,
        allow_creative_escalate: bool | None = None,
        enabled: bool | None = None,
        poll_seconds: int | None = None,
        last_sweep_at: str | None = None,
        last_summary: dict | None = None,
        touch_sweep: bool = False,
        auto_caption: bool | None = None,
        caption_bank_id: str | None = None,
        caption_from_filename: bool | None = None,
    ) -> Workflow | None:
        items = self._load()
        for i, w in enumerate(items):
            if w.id != workflow_id:
                continue
            new_name, inbox, output, new_count, quality, poll = _validate(
                name=w.name if name is None else name,
                inbox_destination_id=w.inbox_destination_id if inbox_destination_id is None else inbox_destination_id,
                output_destination_id=w.output_destination_id if output_destination_id is None else output_destination_id,
                count=w.count if count is None else count,
                quality_mode=w.quality_mode if quality_mode is None else quality_mode,
                poll_seconds=w.poll_seconds if poll_seconds is None else poll_seconds,
            )
            use_filename = (
                w.caption_from_filename if caption_from_filename is None else bool(caption_from_filename)
            )
            use_auto = w.auto_caption if auto_caption is None else bool(auto_caption)
            if caption_from_filename is True:
                use_auto = False
            elif auto_caption is True:
                use_filename = False
            if use_filename:
                use_auto = False
            updated = Workflow(
                id=w.id,
                name=new_name,
                inbox_destination_id=inbox,
                output_destination_id=output,
                count=new_count,
                quality_mode=quality,
                allow_creative_escalate=(
                    w.allow_creative_escalate if allow_creative_escalate is None else bool(allow_creative_escalate)
                ),
                enabled=w.enabled if enabled is None else bool(enabled),
                poll_seconds=poll,
                last_sweep_at=last_sweep_at if touch_sweep else w.last_sweep_at,
                last_summary=last_summary if touch_sweep else w.last_summary,
                auto_caption=use_auto,
                caption_bank_id=(
                    w.caption_bank_id if caption_bank_id is None else str(caption_bank_id or "").strip()
                ),
                caption_from_filename=use_filename,
            )
            items[i] = updated
            self._save(items)
            return updated
        return None

    def delete(self, workflow_id: str) -> bool:
        items = self._load()
        remaining = [w for w in items if w.id != workflow_id]
        if len(remaining) == len(items):
            return False
        self._save(remaining)
        return True

    def _load(self) -> list[Workflow]:
        if not os.path.exists(self._path):
            return []
        with open(self._path, encoding="utf-8") as f:
            raw = json.load(f)
        out: list[Workflow] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            out.append(Workflow(
                id=str(item.get("id") or ""),
                name=str(item.get("name") or ""),
                inbox_destination_id=str(item.get("inbox_destination_id") or ""),
                output_destination_id=str(item.get("output_destination_id") or ""),
                count=int(item.get("count") or DEFAULT_COUNT),
                quality_mode=normalize_quality_mode(item.get("quality_mode")),
                allow_creative_escalate=bool(item.get("allow_creative_escalate", True)),
                enabled=bool(item.get("enabled") or False),
                poll_seconds=int(item.get("poll_seconds") or DEFAULT_POLL_SECONDS),
                last_sweep_at=item.get("last_sweep_at"),
                last_summary=item.get("last_summary") if isinstance(item.get("last_summary"), dict) else None,
                auto_caption=bool(item.get("auto_caption") or False),
                caption_bank_id=str(item.get("caption_bank_id") or ""),
                caption_from_filename=bool(item.get("caption_from_filename") or False),
            ))
        return out

    def _save(self, items: list[Workflow]) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(self._path) or ".", prefix=".workflows-", suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump([asdict(w) for w in items], f, indent=2)
            os.replace(tmp_path, self._path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
