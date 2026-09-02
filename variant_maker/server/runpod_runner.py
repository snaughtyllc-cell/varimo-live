"""GPU runner: same Runner protocol as LocalRunner, but compute runs on a RunPod serverless
worker. Source/variants move through object storage; progress streams back as chunks."""
from __future__ import annotations

import os
from collections.abc import Callable

from .events import VariantEvent
from .runner import (
    DEFAULT_PLATFORM,
    DEFAULT_PRESET,
    MAX_REGEN,
    MIN_BITS_VS_PEERS,
    UNIQ_STRENGTHS,
    UNIQUENESS_TARGET,
    SourceResult,
    VariantResult,
    encode_jobs_for_worker,
    hq_job_limits,
    normalize_quality_mode,
)
from .runpod_client import RunPodClient
from .storage import ObjectStore

DEFAULT_QUALITY_MODE = "hq"   # Tier-2 neural upscale on the GPU


def _quality_mode() -> str:
    """VARIANT_QUALITY_MODE=fast skips Real-ESRGAN (team speed); default hq."""
    mode = os.environ.get("VARIANT_QUALITY_MODE", DEFAULT_QUALITY_MODE).strip().lower()
    return mode if mode in ("fast", "hq") else DEFAULT_QUALITY_MODE


class RunPodServerlessRunner:
    def __init__(self, store: ObjectStore, client: RunPodClient) -> None:
        self._store = store
        self._client = client

    def run(self, source_path: str, *, count: int, out_dir: str, source_id: str,
            on_event: Callable[[VariantEvent], None],
            allow_creative_escalate: bool = True,
            quality_mode: str | None = None,
            cancel_token=None) -> SourceResult:
        basename = os.path.basename(source_path)
        source_key = f"inputs/{source_id}/{basename}"
        self._store.put(source_key, source_path)

        quality_mode = normalize_quality_mode(quality_mode, default=_quality_mode())
        limits = hq_job_limits(quality_mode)
        payload = {"input": {
            "source_key": source_key, "source_id": source_id, "count": count,
            "preset": DEFAULT_PRESET, "platform": DEFAULT_PLATFORM,
            "quality_mode": quality_mode,
            "max_regen": limits.get("max_regen", MAX_REGEN),
            "allow_creative_escalate": limits.get(
                "allow_creative_escalate", allow_creative_escalate,
            ),
            "uniqueness_target": UNIQUENESS_TARGET,
            "uniq_strengths": limits.get("uniq_strengths", list(UNIQ_STRENGTHS)),
            "min_bits_vs_peers": MIN_BITS_VS_PEERS,
            "auto_tune": limits.get("auto_tune", True),
            "jobs": encode_jobs_for_worker(quality_mode, count),
        }}
        return self._consume_stream(
            self._client.stream_run(payload, cancel_token=cancel_token),
            out_dir=out_dir, source_id=source_id, on_event=on_event,
        )

    def resume_run(self, source_path: str, *, count: int, out_dir: str, source_id: str,
                   on_event: Callable[[VariantEvent], None],
                   allow_creative_escalate: bool = True,
                   quality_mode: str | None = None,
                   cancel_token=None, runpod_job_id: str) -> SourceResult:
        """Reconnect to an in-flight RunPod job after Studio restart (no new /run)."""
        del source_path, count, allow_creative_escalate, quality_mode
        resume = getattr(self._client, "stream_resume", None)
        if not callable(resume):
            raise TypeError("RunPod client cannot resume a cloud job")
        return self._consume_stream(
            resume(runpod_job_id, cancel_token=cancel_token),
            out_dir=out_dir, source_id=source_id, on_event=on_event,
        )

    def _file_ready(self, dest: str) -> bool:
        return os.path.isfile(dest) and os.path.getsize(dest) > 0

    def _try_get(self, key: str, dest: str) -> bool:
        try:
            self._store.get(key, dest)
        except Exception as exc:
            print(f"object get {key}: {type(exc).__name__}: {exc}", flush=True)
            return False
        return self._file_ready(dest)

    def _fetch_named(self, source_id: str, out_dir: str, name: str | None) -> bool:
        if not name:
            return False
        base = os.path.basename(str(name))
        if base in ("", ".", "..") or base != str(name):
            return False
        dest = os.path.join(out_dir, base)
        if self._file_ready(dest):
            return True
        if self._try_get(f"outputs/{source_id}/{base}", dest):
            return True
        try:
            keys = self._store.list_prefix(f"outputs/{source_id}/")
        except Exception as exc:
            print(
                f"list_prefix outputs/{source_id}/: {type(exc).__name__}: {exc}",
                flush=True,
            )
            return False
        for key in keys:
            if os.path.basename(key) == base and self._try_get(key, dest):
                return True
        return False

    def _meta_from_event(self, source_id: str, e: dict) -> dict | None:
        filename = e.get("filename")
        index = e.get("index")
        if not filename or index is None:
            return None
        base = os.path.basename(str(filename))
        if base in ("", ".", "..") or base != str(filename):
            return None
        return {
            "index": index, "filename": base,
            "status": e.get("status") or "ok",
            "quality": e.get("quality"),
            "key": f"outputs/{source_id}/{base}",
            "uniqueness": e.get("uniqueness"),
            "uniqueness_status": e.get("uniqueness_status"),
            "uniqueness_metric": e.get("uniqueness_metric"),
            "uniqueness_target": e.get("uniqueness_target"),
            "preset_used": e.get("preset_used"),
            "strength_final": e.get("strength_final"),
            "escalated": bool(e.get("escalated", False)),
            "platform_result": e.get("platform_result"),
            "look_status": e.get("look_status"),
            "look_mae": e.get("look_mae"),
            "look_src": e.get("look_src"),
            "look_var": e.get("look_var"),
        }

    def _recover_variants_meta(self, source_id: str, done_events: list[dict]) -> list[dict]:
        by_index: dict[object, dict] = {}
        for e in done_events:
            meta = self._meta_from_event(source_id, e)
            if meta is None:
                continue
            by_index[meta["index"]] = meta
        if by_index:
            return [by_index[i] for i in sorted(by_index, key=lambda x: int(x))]
        try:
            keys = self._store.list_prefix(f"outputs/{source_id}/")
        except Exception as exc:
            print(
                f"list_prefix outputs/{source_id}/: {type(exc).__name__}: {exc}",
                flush=True,
            )
            return []
        found: list[dict] = []
        for key in keys:
            base = os.path.basename(key)
            stem, ext = os.path.splitext(base)
            if ext.lower() != ".mp4" or not stem.startswith("v") or not stem[1:].isdigit():
                continue
            found.append({
                "index": int(stem[1:]), "filename": base, "status": "ok",
                "quality": {}, "key": key,
            })
        found.sort(key=lambda v: v["index"])
        return found

    def _consume_stream(self, chunks, *, out_dir: str, source_id: str,
                        on_event: Callable[[VariantEvent], None]) -> SourceResult:
        os.makedirs(out_dir, exist_ok=True)
        variants_meta: list[dict] = []
        manifest_key = None
        done_events: list[dict] = []
        for chunk in chunks:
            if chunk.get("type") == "progress":
                e = chunk["event"]
                if e.get("state") == "looking":
                    self._fetch_named(source_id, out_dir, e.get("look_src"))
                    self._fetch_named(source_id, out_dir, e.get("look_var"))
                if e.get("state") == "done" and e.get("filename"):
                    self._fetch_named(source_id, out_dir, e.get("filename"))
                    done_events.append(e)
                on_event(VariantEvent(
                    source_id=source_id, index=e["index"], state=e["state"],
                    attempt=e.get("attempt", 0), max_attempts=e.get("max_attempts", 0),
                    status=e.get("status"), quality=e.get("quality"),
                    filename=e.get("filename"),
                    uniqueness=e.get("uniqueness"),
                    uniqueness_status=e.get("uniqueness_status"),
                    uniqueness_metric=e.get("uniqueness_metric"),
                    uniqueness_target=e.get("uniqueness_target"),
                    escalated=bool(e.get("escalated", False)),
                    preset_used=e.get("preset_used"),
                    strength_final=e.get("strength_final"),
                    platform_result=e.get("platform_result"),
                    look_status=e.get("look_status"),
                    look_mae=e.get("look_mae"),
                    look_src=e.get("look_src"),
                    look_var=e.get("look_var"),
                ))
            elif chunk.get("type") == "result":
                variants_meta = list(chunk.get("variants") or [])
                manifest_key = chunk.get("manifest_key")

        if not variants_meta:
            variants_meta = self._recover_variants_meta(source_id, done_events)
            if not manifest_key:
                manifest_key = f"outputs/{source_id}/manifest.json"

        variants = []
        for v in variants_meta:
            filename = v.get("filename")
            if not filename:
                continue
            local = os.path.join(out_dir, filename)
            key = v.get("key") or f"outputs/{source_id}/{filename}"
            if not self._file_ready(local) and not self._try_get(key, local):
                self._fetch_named(source_id, out_dir, filename)
            self._fetch_named(source_id, out_dir, v.get("look_src"))
            self._fetch_named(source_id, out_dir, v.get("look_var"))
            variants.append(VariantResult(
                index=v["index"], filename=filename,
                status=v.get("status") or "ok", quality=v.get("quality"), path=local,
                uniqueness=v.get("uniqueness"),
                uniqueness_status=v.get("uniqueness_status"),
                uniqueness_metric=v.get("uniqueness_metric"),
                uniqueness_target=v.get("uniqueness_target"),
                preset_used=v.get("preset_used"),
                strength_final=v.get("strength_final"),
                escalated=bool(v.get("escalated", False)),
                platform_result=v.get("platform_result"),
                look_status=v.get("look_status"),
                look_mae=v.get("look_mae"),
                look_src=v.get("look_src"),
                look_var=v.get("look_var"),
            ))
        manifest_path = os.path.join(out_dir, "manifest.json")
        if (manifest_key and not self._file_ready(manifest_path)
                and not self._try_get(manifest_key, manifest_path)):
            self._fetch_named(source_id, out_dir, "manifest.json")
        return SourceResult(variants=variants, manifest_path=manifest_path)

    def fetch_outputs(self, source_id: str, out_dir: str, filenames: list[str]) -> int:
        """Pull variant files already in object storage (GPU finished, Studio missed the copy)."""
        os.makedirs(out_dir, exist_ok=True)
        got = 0
        for raw in filenames:
            name = os.path.basename(raw)
            if not name or name in (".", ".."):
                continue
            dest = os.path.join(out_dir, name)
            if self._file_ready(dest):
                got += 1
                continue
            if self._fetch_named(source_id, out_dir, name):
                got += 1
        return got
