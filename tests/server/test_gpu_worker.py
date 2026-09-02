import os

from variant_maker.server import gpu_worker
from tests.server.fakes import FakeObjectStore


def test_process_job_streams_progress_then_uploads_and_results(monkeypatch, tmp_path):
    store = FakeObjectStore()
    # stage the source object the worker will download
    src = tmp_path / "src.mp4"
    src.write_bytes(b"SRC")
    store.put("inputs/s1/src.mp4", str(src))

    class FakeRecord:
        def __init__(self, index, filename, status, quality):
            self.index, self.filename, self.status, self.quality = index, filename, status, quality

    class FakeManifest:
        def __init__(self, variants):
            self.variants = variants

    def fake_run(config, *, on_event=None):
        assert config["uniqueness_target"] == 0.5
        assert config["allow_creative_escalate"] is False
        out = config["out"]
        recs = []
        for i, status in [(1, "ok"), (2, "corrupt")]:
            fname = f"v{i:02d}.mp4"
            on_event("rendering", index=i, attempt=0)
            look_src = f"look_v{i:02d}_src.jpg"
            look_var = f"look_v{i:02d}.jpg"
            open(os.path.join(out, look_src), "w").close()
            open(os.path.join(out, look_var), "w").close()
            rec = FakeRecord(i, fname, status, {"vmaf": 95.0})
            rec.look_src = look_src
            rec.look_var = look_var
            rec.look_status = "ok"
            rec.look_mae = 8.0
            on_event(
                "looking", index=i, look_src=look_src, look_var=look_var,
                look_status="ok", look_mae=8.0,
            )
            on_event("done", index=i, status=status,
                     quality={"vmaf": 95.0 if status == "ok" else 5.0}, filename=fname)
            open(os.path.join(out, fname), "w").close()
            recs.append(rec)
        open(os.path.join(out, "manifest.json"), "w").close()
        return FakeManifest(recs)

    monkeypatch.setattr(gpu_worker.pipeline, "run", fake_run)

    job_input = {
        "source_key": "inputs/s1/src.mp4", "source_id": "s1", "count": 2,
        "uniqueness_target": 0.5, "allow_creative_escalate": False,
    }
    chunks = list(gpu_worker.process_job(job_input, store, work_dir=str(tmp_path / "work")))

    progress = [c for c in chunks if c["type"] == "progress"]
    results = [c for c in chunks if c["type"] == "result"]
    # progress streamed for both variants, including the corrupt one
    assert [c["event"]["state"] for c in progress[:3]] == ["rendering", "looking", "done"]
    assert {c["event"].get("status") for c in progress if c["event"]["state"] == "done"} == {"ok", "corrupt"}
    # exactly one result chunk, variants uploaded under outputs/<source_id>/
    assert len(results) == 1
    res = results[0]
    assert [v["status"] for v in res["variants"]] == ["ok", "corrupt"]
    assert res["manifest_key"] == "outputs/s1/manifest.json"
    assert "outputs/s1/v01.mp4" in store.list_prefix("outputs/s1/")
    assert "outputs/s1/v02.mp4" in store.list_prefix("outputs/s1/")
    assert "outputs/s1/look_v01_src.jpg" in store.list_prefix("outputs/s1/")
    assert "outputs/s1/look_v01.jpg" in store.list_prefix("outputs/s1/")
    looking = [c for c in progress if c["event"]["state"] == "looking"]
    assert looking and looking[0]["event"]["look_src"] == "look_v01_src.jpg"
    # each result variant carries its object key
    assert res["variants"][0]["key"] == "outputs/s1/v01.mp4"


def test_process_job_uploads_each_mp4_when_done_fires(monkeypatch, tmp_path):
    """Studio can copy as soon as a variant is done — do not wait for the pack result."""
    store = FakeObjectStore()
    src = tmp_path / "src.mp4"
    src.write_bytes(b"SRC")
    store.put("inputs/s1/src.mp4", str(src))

    class FakeRecord:
        def __init__(self, index, filename, status, quality):
            self.index, self.filename, self.status, self.quality = index, filename, status, quality

    class FakeManifest:
        def __init__(self, variants):
            self.variants = variants

    def fake_run(config, *, on_event=None):
        out = config["out"]
        fname = "v01.mp4"
        with open(os.path.join(out, fname), "wb") as f:
            f.write(b"EARLY-MP4")
        rec = FakeRecord(1, fname, "ok", {"vmaf": 95.0})
        on_event("done", index=1, status="ok", quality={"vmaf": 95.0}, filename=fname)
        open(os.path.join(out, "manifest.json"), "w").close()
        return FakeManifest([rec])

    monkeypatch.setattr(gpu_worker.pipeline, "run", fake_run)
    job_input = {
        "source_key": "inputs/s1/src.mp4", "source_id": "s1", "count": 1,
    }
    saw_done = False
    for chunk in gpu_worker.process_job(job_input, store, work_dir=str(tmp_path / "work")):
        if chunk.get("type") == "progress" and chunk["event"]["state"] == "done":
            assert "outputs/s1/v01.mp4" in store.list_prefix("outputs/s1/")
            saw_done = True
    assert saw_done


def _capture_jobs(monkeypatch, tmp_path, job_input):
    store = FakeObjectStore()
    src = tmp_path / "src.mp4"
    src.write_bytes(b"SRC")
    store.put(job_input["source_key"], str(src))
    captured = {}

    def fake_run(config, *, on_event=None):
        captured.update(config)

        class M:
            variants = []

        open(os.path.join(config["out"], "manifest.json"), "w").close()
        return M()

    monkeypatch.setattr(gpu_worker.pipeline, "run", fake_run)
    list(gpu_worker.process_job(job_input, store, work_dir=str(tmp_path / "work")))
    return captured


def test_fast_worker_parallelizes_20_pack_even_without_jobs_key(monkeypatch, tmp_path):
    monkeypatch.setattr("variant_maker.server.runner.os.cpu_count", lambda: 16)
    captured = _capture_jobs(monkeypatch, tmp_path, {
        "source_key": "inputs/s1/src.mp4", "source_id": "s1", "count": 20,
        "quality_mode": "fast",
    })
    assert captured["jobs"] == 8
    assert captured["uniqueness_target"] == 24 / 64


def test_fast_worker_honors_payload_jobs_when_container_reports_one_cpu(monkeypatch, tmp_path):
    """GPU serverless often advertises 1 CPU. That recap made Norway-wood serial."""
    monkeypatch.setattr("variant_maker.server.runner.os.cpu_count", lambda: 1)
    captured = _capture_jobs(monkeypatch, tmp_path, {
        "source_key": "inputs/s1/src.mp4", "source_id": "s1", "count": 20,
        "quality_mode": "fast", "jobs": 8,
    })
    assert captured["jobs"] == 8


def test_hq_worker_stays_serial_even_if_jobs_requested(monkeypatch, tmp_path):
    captured = _capture_jobs(monkeypatch, tmp_path, {
        "source_key": "inputs/s1/src.mp4", "source_id": "s1", "count": 20,
        "quality_mode": "hq", "jobs": 8,
    })
    assert captured["jobs"] == 1
