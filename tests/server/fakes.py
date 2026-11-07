"""A deterministic Runner that needs no ffmpeg — for JobStore / app tests."""
from __future__ import annotations

import os
from typing import Callable

from variant_maker.server.events import VariantEvent
from variant_maker.server.gpu_worker import process_job
from variant_maker.server.runner import SourceResult, VariantResult


class FakeRunner:
    """plan: {variant_index: status}. Emits the full lifecycle and writes placeholder files."""

    def __init__(self, plan: dict[int, str] | None = None) -> None:
        # default (empty plan): every variant is "ok".
        # Pass a {variant_index: status} dict to override specific indices.
        self.plan = plan or {}

    def _status(self, i: int) -> str:
        return self.plan.get(i, "ok")

    def run(self, source_path: str, *, count: int, out_dir: str, source_id: str,
            on_event: Callable[[VariantEvent], None],
            allow_creative_escalate: bool = True,
            quality_mode: str = "fast",
            cancel_token=None, motion=None) -> SourceResult:
        self.last_motion = motion
        self.last_quality_mode = quality_mode
        self.last_allow_creative_escalate = allow_creative_escalate
        os.makedirs(out_dir, exist_ok=True)
        variants = []
        for i in range(1, count + 1):
            if cancel_token is not None and cancel_token.is_set():
                from variant_maker.server.cancel import JobCancelled
                raise JobCancelled()
            status = self._status(i)
            fname = f"v{i:02d}.mp4"
            on_event(VariantEvent(source_id=source_id, index=i, state="rendering"))
            on_event(VariantEvent(source_id=source_id, index=i, state="checking"))
            look_src = f"look_v{i:02d}_src.jpg"
            look_var = f"look_v{i:02d}.jpg"
            open(os.path.join(out_dir, look_src), "w").close()
            open(os.path.join(out_dir, look_var), "w").close()
            on_event(VariantEvent(
                source_id=source_id, index=i, state="looking", filename=fname,
                look_status="ok", look_mae=8.0, look_src=look_src, look_var=look_var,
            ))
            uniq_target = 24 / 64
            if status == "ok":
                uniq, uniq_status, uniq_metric = 0.42, "ok", "ssim_bits_v1"
                quality = {"vmaf": 95.0, "bits": 27, "passed": True, "histogram_ok": True, "regen_count": 0}
            elif status == "uniqueness_fail":
                uniq, uniq_status, uniq_metric = 12 / 64, "below_floor", "ssim_bits_v1"
                quality = {"vmaf": 95.0, "bits": 12, "passed": True, "histogram_ok": True, "regen_count": 0}
            else:
                uniq, uniq_status, uniq_metric = None, "unknown", None
                quality = {"vmaf": 50.0, "bits": None, "passed": False, "histogram_ok": True, "regen_count": 3}
            on_event(VariantEvent(
                source_id=source_id, index=i, state="done",
                status=status, quality=quality, filename=fname,
                uniqueness=uniq, uniqueness_status=uniq_status,
                uniqueness_metric=uniq_metric, uniqueness_target=uniq_target,
                escalated=False, preset_used="medium", strength_final=1.0,
                look_status="ok", look_mae=8.0, look_src=look_src, look_var=look_var,
            ))
            path = os.path.join(out_dir, fname)
            open(path, "w").close()
            variants.append(VariantResult(
                index=i, filename=fname, status=status, quality=quality, path=path,
                uniqueness=uniq, uniqueness_status=uniq_status,
                uniqueness_metric=uniq_metric, uniqueness_target=uniq_target,
                preset_used="medium", strength_final=1.0, escalated=False,
                platform_result=None,
                look_status="ok", look_mae=8.0, look_src=look_src, look_var=look_var,
            ))
        mpath = os.path.join(out_dir, "manifest.json")
        import json
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump({
                "created_utc": "2026-01-01T00:00:00Z",
                "source": {"path": source_path},
                "run": {"platform": "tiktok", "count": count, "preset": "medium"},
                "variants": [
                    {
                        "index": v.index,
                        "filename": v.filename,
                        "status": v.status,
                        "quality": v.quality,
                        "uniqueness": v.uniqueness,
                        "uniqueness_status": v.uniqueness_status,
                        "uniqueness_metric": v.uniqueness_metric,
                        "uniqueness_target": v.uniqueness_target,
                        "preset_used": v.preset_used,
                        "strength_final": v.strength_final,
                        "escalated": v.escalated,
                        "platform_result": v.platform_result,
                        "seed": v.index,
                        "params": {"video": {"crop_keep": 0.97}},
                    }
                    for v in variants
                ],
            }, f)
        return SourceResult(variants=variants, manifest_path=mpath)


class FakeRunPodClient:
    """Yields a scripted list of output chunks; ignores the payload. No network."""

    def __init__(self, chunks: list[dict]) -> None:
        self._chunks = chunks

    def stream_run(self, payload: dict, cancel_token=None):
        yield from self._chunks

    def stream_resume(self, job_id: str, cancel_token=None):
        yield from self._chunks


class LoopbackRunPodClient:
    """Drives the REAL gpu_worker.process_job against a shared store — no network, no cloud.
    Used to verify the runner<->worker chunk contract end to end."""

    def __init__(self, store, work_dir: str) -> None:
        self._store = store
        self._work_dir = work_dir

    def stream_run(self, payload: dict, cancel_token=None):
        yield from process_job(payload["input"], self._store, work_dir=self._work_dir)


class FakeObjectStore:
    """In-memory object store for tests — no network, no boto3."""

    def __init__(self) -> None:
        self._data: dict[str, bytes] = {}

    def put(self, key: str, local_path: str) -> None:
        with open(local_path, "rb") as f:
            self._data[key] = f.read()

    def get(self, key: str, local_path: str) -> None:
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(self._data[key])

    def list_prefix(self, prefix: str) -> list[str]:
        return [k for k in self._data if k.startswith(prefix)]

    def delete_prefix(self, prefix: str) -> int:
        if not prefix:
            return 0
        keys = [k for k in self._data if k.startswith(prefix)]
        for k in keys:
            del self._data[k]
        return len(keys)
