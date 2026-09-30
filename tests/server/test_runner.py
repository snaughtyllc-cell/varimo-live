import os

import pytest

from variant_maker.server.events import VariantEvent, event_to_dict
from variant_maker.server.runner import LocalRunner, SourceResult, VariantResult


def test_variant_event_to_dict_roundtrips_fields():
    e = VariantEvent(
        source_id="s1", index=3, state="done",
        attempt=2, max_attempts=3, status="ok",
        quality={"vmaf": 91.0}, filename="clip_v03_abcd1234.mp4",
        uniqueness=0.42, uniqueness_status="ok",
        uniqueness_metric="ssim_bits_v1", uniqueness_target=24 / 64,
        escalated=True, preset_used="strong", strength_final=1.0,
    )
    d = event_to_dict(e)
    assert d == {
        "source_id": "s1", "index": 3, "state": "done",
        "attempt": 2, "max_attempts": 3, "status": "ok",
        "quality": {"vmaf": 91.0}, "filename": "clip_v03_abcd1234.mp4",
        "uniqueness": 0.42, "uniqueness_status": "ok",
        "uniqueness_metric": "ssim_bits_v1", "uniqueness_target": 24 / 64,
        "escalated": True, "preset_used": "strong", "strength_final": 1.0,
        "platform_result": None,
        "look_status": None, "look_mae": None, "look_src": None, "look_var": None,
    }


def test_variant_event_defaults():
    e = VariantEvent(source_id="s1", index=1, state="rendering")
    d = event_to_dict(e)
    assert d["attempt"] == 0 and d["status"] is None and d["quality"] is None


def test_localrunner_translates_engine_events_and_maps_results(monkeypatch, tmp_path):
    from variant_maker.server import runner as runner_mod

    # Fake pipeline.run: emit engine events for 2 variants, write files, return a manifest.
    class FakeManifest:
        def __init__(self, variants):
            self.variants = variants

    class FakeRecord:
        def __init__(self, index, filename, status, quality):
            self.index, self.filename, self.status, self.quality = index, filename, status, quality

    def fake_run(config, *, on_event=None):
        out = config["out"]
        recs = []
        for i, status in [(1, "ok"), (2, "best_effort")]:
            fname = f"clip_v0{i}_x.mp4"
            on_event("rendering", index=i)
            on_event("checking", index=i)
            on_event("done", index=i, status=status,
                     quality={"vmaf": 95.0 if status == "ok" else 50.0}, filename=fname)
            open(f"{out}/{fname}", "w").close()
            recs.append(FakeRecord(i, fname, status, {"vmaf": 95.0}))
        open(f"{out}/manifest.json", "w").close()
        return FakeManifest(recs)

    monkeypatch.setattr(runner_mod.pipeline, "run", fake_run)

    events: list[VariantEvent] = []
    out_dir = str(tmp_path)
    result = LocalRunner().run(
        "src.mp4", count=2, out_dir=out_dir, source_id="srcA",
        on_event=events.append,
    )

    assert isinstance(result, SourceResult)
    assert [v.status for v in result.variants] == ["ok", "best_effort"]
    assert all(isinstance(v, VariantResult) for v in result.variants)
    # every forwarded event is tagged with the source_id
    assert events and all(e.source_id == "srcA" for e in events)
    # lifecycle present, done events carry status
    states = [e.state for e in events]
    assert "rendering" in states and "done" in states
    assert {e.status for e in events if e.state == "done"} == {"ok", "best_effort"}


def test_localrunner_sets_fast_tier1_defaults(monkeypatch, tmp_path):
    from variant_maker.server import runner as runner_mod
    captured = {}

    def fake_run(config, *, on_event=None):
        captured.update(config)
        open(f"{config['out']}/manifest.json", "w").close()

        class M:
            variants = []

        return M()

    monkeypatch.setattr(runner_mod.pipeline, "run", fake_run)
    monkeypatch.setattr(runner_mod.os, "cpu_count", lambda: 16)
    LocalRunner().run("src.mp4", count=5, out_dir=str(tmp_path), source_id="s", on_event=lambda e: None)
    assert captured["quality_mode"] == "fast"
    assert captured["preset"] == "medium"
    assert captured["platform"] == "tiktok"
    assert captured["max_regen"] == 3
    assert captured["jobs"] == 5
    assert captured["count"] == 5
    assert captured["auto_tune"] is True


def test_localrunner_honors_quality_mode_hq(monkeypatch, tmp_path):
    from variant_maker.server import runner as runner_mod
    captured = {}

    def fake_run(config, *, on_event=None):
        captured.update(config)
        open(f"{config['out']}/manifest.json", "w").close()

        class M:
            variants = []

        return M()

    monkeypatch.setattr(runner_mod.pipeline, "run", fake_run)
    monkeypatch.setattr(runner_mod.os, "cpu_count", lambda: 16)
    LocalRunner().run(
        "src.mp4", count=5, out_dir=str(tmp_path), source_id="s",
        on_event=lambda e: None, quality_mode="hq",
    )
    assert captured["quality_mode"] == "hq"
    assert captured["auto_tune"] is False
    assert captured["jobs"] == 1


def test_encode_jobs_hq_serial_fast_parallel():
    from variant_maker.server.runner import (
        DEFAULT_FAST_JOBS,
        encode_jobs,
        encode_jobs_for_worker,
    )

    assert encode_jobs("hq", 20, cpu_count=16) == 1
    assert encode_jobs("hq", 1, cpu_count=16) == 1
    assert encode_jobs("fast", 20, cpu_count=16) == DEFAULT_FAST_JOBS
    assert encode_jobs("fast", 20, cpu_count=4) == 4
    assert encode_jobs("fast", 3, cpu_count=16) == 3
    assert encode_jobs("fast", 20, requested=1, cpu_count=16) == 1
    assert encode_jobs("fast", 20, requested=8, cpu_count=4) == 4
    # Studio (2 vCPU) must not shrink the GPU payload.
    assert encode_jobs_for_worker("fast", 20) == DEFAULT_FAST_JOBS
    assert encode_jobs_for_worker("hq", 20) == 1


def test_should_run_fast_local_only_tiny_fast_packs():
    from variant_maker.server.runner import should_run_fast_local

    assert should_run_fast_local("fast", 1) is True
    assert should_run_fast_local("fast", 3) is True
    assert should_run_fast_local("fast", 4) is False
    assert should_run_fast_local("fast", 20) is False
    assert should_run_fast_local("hq", 1) is False
    assert should_run_fast_local("hq", 3) is False
    assert should_run_fast_local("fast", 3, max_local_fast=0) is False


def test_routing_runner_sends_tiny_fast_to_local_else_remote():
    from variant_maker.server.runner import RoutingRunner, SourceResult

    class Fake:
        def __init__(self, name):
            self.name = name
            self.calls = []

        def run(self, *args, **kw):
            self.calls.append(kw)
            return SourceResult(variants=[], manifest_path="")

    local, remote = Fake("local"), Fake("remote")
    router = RoutingRunner(local, remote, max_local_fast=3)
    router.run("s.mp4", count=3, out_dir="o", source_id="s", on_event=lambda e: None, quality_mode="fast")
    router.run("s.mp4", count=20, out_dir="o", source_id="s", on_event=lambda e: None, quality_mode="fast")
    router.run("s.mp4", count=1, out_dir="o", source_id="s", on_event=lambda e: None, quality_mode="hq")
    assert len(local.calls) == 1 and local.calls[0]["count"] == 3
    assert [c["count"] for c in remote.calls] == [20, 1]
    assert remote.calls[1]["quality_mode"] == "hq"


def test_routing_runner_sends_all_fast_to_fast_remote_when_set(tmp_path):
    from variant_maker.server.runner import RoutingRunner, SourceResult

    class Fake:
        def __init__(self, name):
            self.name = name
            self.calls = []
            self.resumes = []

        def run(self, *args, **kw):
            self.calls.append(kw)
            os.makedirs(kw["out_dir"], exist_ok=True)
            path = os.path.join(kw["out_dir"], f"clip_{len(self.calls):08x}.mp4")
            with open(path, "wb") as fh:
                fh.write(b"mp4")
            return SourceResult(variants=[], manifest_path="")

        def resume_run(self, *args, **kw):
            self.resumes.append(kw)
            return SourceResult(variants=[], manifest_path="")

    local, gpu, fast = Fake("local"), Fake("gpu"), Fake("fast")
    router = RoutingRunner(local, gpu, fast_remote=fast, max_local_fast=3)
    out = str(tmp_path)
    router.run("s.mp4", count=3, out_dir=out, source_id="s", on_event=lambda e: None, quality_mode="fast")
    router.run("s.mp4", count=20, out_dir=out, source_id="s", on_event=lambda e: None, quality_mode="fast")
    router.run("s.mp4", count=1, out_dir=out, source_id="s", on_event=lambda e: None, quality_mode="hq")
    assert not local.calls
    assert [c["count"] for c in fast.calls] == [3, 20]
    assert gpu.calls[0]["count"] == 1 and gpu.calls[0]["quality_mode"] == "hq"
    router.resume_run(
        "s.mp4", count=20, out_dir="o", source_id="s",
        on_event=lambda e: None, quality_mode="fast", runpod_job_id="rp1",
    )
    router.resume_run(
        "s.mp4", count=1, out_dir="o", source_id="s",
        on_event=lambda e: None, quality_mode="hq", runpod_job_id="rp2",
    )
    assert fast.resumes and fast.resumes[0]["runpod_job_id"] == "rp1"
    assert gpu.resumes and gpu.resumes[0]["runpod_job_id"] == "rp2"


def test_routing_runner_retries_gpu_when_fast_fails_before_done():
    from variant_maker.server.runner import RoutingRunner

    class FastDown:
        def run(self, *args, **kw):
            raise RuntimeError("RunPod job abc ended: FAILED")

    class Gpu:
        def __init__(self):
            self.calls = []

        def run(self, *args, **kw):
            self.calls.append(kw)
            return SourceResult(variants=[], manifest_path="gpu")

    gpu = Gpu()
    router = RoutingRunner(object(), gpu, fast_remote=FastDown(), max_local_fast=3)
    out = router.run(
        "s.mp4", count=8, out_dir="o", source_id="s",
        on_event=lambda e: None, quality_mode="fast",
    )
    assert out.manifest_path == "gpu"
    assert len(gpu.calls) == 1
    assert gpu.calls[0]["quality_mode"] == "fast"
    assert gpu.calls[0]["count"] == 8


def test_routing_runner_keeps_fast_pack_when_a_copy_already_landed(tmp_path):
    from variant_maker.server.runner import RoutingRunner

    out = tmp_path / "out"
    out.mkdir()
    (out / "clip_abcd1234.mp4").write_bytes(b"mp4")

    class FastPartial:
        def run(self, *args, on_event, **kw):
            on_event(VariantEvent(
                source_id=kw["source_id"], index=1, state="done",
                status="ok", filename="clip_abcd1234.mp4",
            ))
            raise RuntimeError("RunPod job abc ended: FAILED")

    class Gpu:
        def __init__(self):
            self.calls = 0

        def run(self, *args, **kw):
            self.calls += 1
            raise AssertionError("gpu should not re-encode a pack that already has a file")

    gpu = Gpu()
    router = RoutingRunner(object(), gpu, fast_remote=FastPartial())
    with pytest.raises(RuntimeError, match="ended: FAILED"):
        router.run(
            "s.mp4", count=8, out_dir=str(out), source_id="s",
            on_event=lambda e: None, quality_mode="fast",
        )
    assert gpu.calls == 0


def test_routing_runner_retries_gpu_when_fast_scores_but_no_file_lands(tmp_path):
    from variant_maker.server.runner import RoutingRunner

    class FastGhost:
        def run(self, *args, on_event, **kw):
            on_event(VariantEvent(
                source_id=kw["source_id"], index=1, state="done",
                status="ok", filename="clip_abcd1234.mp4", quality={"vmaf": 95},
            ))
            return SourceResult(variants=[], manifest_path="fast-empty")

    class Gpu:
        def __init__(self):
            self.calls = []

        def run(self, *args, **kw):
            self.calls.append(kw)
            return SourceResult(variants=[], manifest_path="gpu")

    gpu = Gpu()
    router = RoutingRunner(object(), gpu, fast_remote=FastGhost())
    out = router.run(
        "s.mp4", count=8, out_dir=str(tmp_path), source_id="s",
        on_event=lambda e: None, quality_mode="fast",
    )
    assert out.manifest_path == "gpu"
    assert len(gpu.calls) == 1
    assert gpu.calls[0]["quality_mode"] == "fast"


def test_routing_runner_retries_gpu_when_fast_times_out_with_no_file(tmp_path):
    from variant_maker.server.runner import RoutingRunner

    class FastTimeout:
        def run(self, *args, **kw):
            raise RuntimeError("RunPod job abc ended: TIMED_OUT")

    class Gpu:
        def __init__(self):
            self.calls = 0

        def run(self, *args, **kw):
            self.calls += 1
            return SourceResult(variants=[], manifest_path="gpu")

    gpu = Gpu()
    router = RoutingRunner(object(), gpu, fast_remote=FastTimeout())
    out = router.run(
        "s.mp4", count=8, out_dir=str(tmp_path), source_id="s",
        on_event=lambda e: None, quality_mode="fast",
    )
    assert gpu.calls == 1
    assert out.manifest_path == "gpu"


def test_routing_runner_does_not_retry_when_timeout_already_landed_a_file(tmp_path):
    from variant_maker.server.runner import RoutingRunner

    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "clip_abcd1234.mp4").write_bytes(b"mp4")

    class FastTimeout:
        def run(self, *args, **kw):
            raise RuntimeError("RunPod job abc ended: TIMED_OUT")

    class Gpu:
        def __init__(self):
            self.calls = 0

        def run(self, *args, **kw):
            self.calls += 1
            raise AssertionError("timeout must not re-encode a pack that already has a file")

    gpu = Gpu()
    router = RoutingRunner(object(), gpu, fast_remote=FastTimeout())
    with pytest.raises(RuntimeError, match="TIMED_OUT"):
        router.run(
            "s.mp4", count=8, out_dir=str(out_dir), source_id="s",
            on_event=lambda e: None, quality_mode="fast",
        )
    assert gpu.calls == 0


def test_encode_jobs_for_worker_ignores_container_cpu_count(monkeypatch):
    from variant_maker.server.runner import encode_jobs_for_worker

    monkeypatch.setattr("variant_maker.server.runner.os.cpu_count", lambda: 1)
    assert encode_jobs_for_worker("fast", 20, requested=8) == 8
    assert encode_jobs_for_worker("hq", 20, requested=8) == 1
