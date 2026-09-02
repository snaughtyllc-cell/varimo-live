"""Worker core: download source -> pipeline.run (HQ) streaming progress -> upload variants.

`process_job` is a generator that yields the locked progress/result chunks. pipeline.run is
blocking and calls on_event synchronously, so it runs on a background thread and pushes events
into a queue that the generator drains (same threading pattern as JobStore)."""
from __future__ import annotations

import os
import queue
import threading
from collections.abc import Iterator

from .. import pipeline
from .runner import (
    DEFAULT_PLATFORM,
    DEFAULT_PRESET,
    MAX_REGEN,
    MIN_BITS_VS_PEERS,
    UNIQ_STRENGTHS,
    UNIQUENESS_TARGET,
    encode_jobs_for_worker,
)
from .storage import ObjectStore


def _progress_chunk(state: str, kw: dict) -> dict:
    return {"type": "progress", "event": {
        "index": kw.get("index"), "state": state,
        "attempt": kw.get("attempt", 0), "max_attempts": kw.get("max_attempts", 0),
        "status": kw.get("status"), "quality": kw.get("quality"),
        "filename": kw.get("filename"),
        "uniqueness": kw.get("uniqueness"),
        "uniqueness_status": kw.get("uniqueness_status"),
        "uniqueness_metric": kw.get("uniqueness_metric"),
        "uniqueness_target": kw.get("uniqueness_target"),
        "escalated": bool(kw.get("escalated", False)),
        "preset_used": kw.get("preset_used"),
        "strength_final": kw.get("strength_final"),
        "platform_result": kw.get("platform_result"),
        "look_status": kw.get("look_status"),
        "look_mae": kw.get("look_mae"),
        "look_src": kw.get("look_src"),
        "look_var": kw.get("look_var"),
    }}


def _put_named(store: ObjectStore, source_id: str, out_dir: str, name: str | None) -> None:
    if not name:
        return
    base = os.path.basename(str(name))
    if base in ("", ".", "..") or base != str(name):
        return
    path = os.path.join(out_dir, base)
    if os.path.isfile(path):
        store.put(f"outputs/{source_id}/{base}", path)


def process_job(job_input: dict, store: ObjectStore, *, work_dir: str) -> Iterator[dict]:
    source_key = job_input["source_key"]
    source_id = job_input["source_id"]
    count = job_input["count"]
    basename = os.path.basename(source_key)

    in_path = os.path.join(work_dir, "in", basename)
    store.get(source_key, in_path)
    out_dir = os.path.join(work_dir, "out")
    os.makedirs(out_dir, exist_ok=True)

    quality_mode = job_input.get("quality_mode", "hq")
    auto_tune = job_input.get("auto_tune")
    if auto_tune is None:
        auto_tune = quality_mode != "hq"
    config = {
        "input": in_path, "out": out_dir, "count": count,
        "preset": job_input.get("preset", DEFAULT_PRESET),
        "platform": job_input.get("platform", DEFAULT_PLATFORM),
        "quality_mode": quality_mode,
        "max_regen": job_input.get("max_regen", MAX_REGEN),
            "jobs": encode_jobs_for_worker(
                quality_mode, count, requested=job_input.get("jobs"),
            ),
        "uniqueness_target": job_input.get("uniqueness_target", UNIQUENESS_TARGET),
        "uniq_strengths": job_input.get("uniq_strengths", list(UNIQ_STRENGTHS)),
        "min_bits_vs_peers": job_input.get("min_bits_vs_peers", MIN_BITS_VS_PEERS),
        "allow_creative_escalate": job_input.get("allow_creative_escalate", True),
        "auto_tune": auto_tune,
        "rubberband": job_input.get("rubberband"),
    }

    q: queue.Queue = queue.Queue()
    DONE = object()
    holder: dict = {}

    def emit(state: str, **kw) -> None:
        try:
            if state == "looking":
                _put_named(store, source_id, out_dir, kw.get("look_src"))
                _put_named(store, source_id, out_dir, kw.get("look_var"))
            elif state == "done":
                # Upload before the done chunk leaves the worker. Studio copies on
                # that event; waiting until the pack result is how Gallery got
                # "GPU finished, but videos didn't copy back".
                _put_named(store, source_id, out_dir, kw.get("filename"))
                _put_named(store, source_id, out_dir, kw.get("look_src"))
                _put_named(store, source_id, out_dir, kw.get("look_var"))
        except Exception as exc:
            print(
                f"gpu_worker upload {source_id} {state}: {type(exc).__name__}: {exc}",
                flush=True,
            )
        q.put(_progress_chunk(state, kw))

    def work() -> None:
        try:
            holder["manifest"] = pipeline.run(config, on_event=emit)
        except Exception as e:  # surface worker failure to the generator
            holder["error"] = e
        finally:
            q.put(DONE)

    t = threading.Thread(target=work, daemon=True)
    t.start()
    while True:
        item = q.get()
        if item is DONE:
            break
        yield item
    t.join()
    if "error" in holder:
        raise holder["error"]

    manifest = holder["manifest"]
    variants = []
    for v in manifest.variants:
        key = f"outputs/{source_id}/{v.filename}"
        store.put(key, os.path.join(out_dir, v.filename))
        _put_named(store, source_id, out_dir, getattr(v, "look_src", None))
        _put_named(store, source_id, out_dir, getattr(v, "look_var", None))
        variants.append({
            "index": v.index, "filename": v.filename,
            "status": v.status, "quality": v.quality, "key": key,
            "uniqueness": getattr(v, "uniqueness", None),
            "uniqueness_status": getattr(v, "uniqueness_status", None),
            "uniqueness_metric": getattr(v, "uniqueness_metric", None),
            "uniqueness_target": getattr(v, "uniqueness_target", None),
            "preset_used": getattr(v, "preset_used", None),
            "strength_final": getattr(v, "strength_final", None),
            "escalated": bool(getattr(v, "escalated", False)),
            "platform_result": getattr(v, "platform_result", None),
            "look_status": getattr(v, "look_status", None),
            "look_mae": getattr(v, "look_mae", None),
            "look_src": getattr(v, "look_src", None),
            "look_var": getattr(v, "look_var", None),
        })
    manifest_key = f"outputs/{source_id}/manifest.json"
    store.put(manifest_key, os.path.join(out_dir, "manifest.json"))
    yield {"type": "result", "variants": variants, "manifest_key": manifest_key}
