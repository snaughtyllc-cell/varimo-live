import os

from tests.server.fakes import FakeObjectStore, FakeRunPodClient
from variant_maker.server.events import VariantEvent
from variant_maker.server.runner import SourceResult, VariantResult
from variant_maker.server.runpod_runner import RunPodServerlessRunner
from variant_maker.uniqueness import DEFAULT_TARGET


def test_runner_uploads_source_streams_events_downloads_variants(tmp_path):
    store = FakeObjectStore()
    # Pre-stage what the "worker" would have uploaded: two variant files + manifest.
    for key, body in [("outputs/srcA/v01.mp4", b"V1"),
                      ("outputs/srcA/v02.mp4", b"V2"),
                      ("outputs/srcA/manifest.json", b"{}")]:
        p = tmp_path / "stage" / os.path.basename(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        store.put(key, str(p))

    chunks = [
        {"type": "progress", "event": {"index": 1, "state": "rendering", "attempt": 0}},
        {"type": "progress", "event": {"index": 1, "state": "done", "status": "ok",
                                       "quality": {"vmaf": 95.0}, "filename": "v01.mp4"}},
        {"type": "progress", "event": {"index": 2, "state": "done", "status": "corrupt",
                                       "quality": {"vmaf": 10.0}, "filename": "v02.mp4"}},
        {"type": "result", "variants": [
            {"index": 1, "filename": "v01.mp4", "status": "ok",
             "quality": {"vmaf": 95.0}, "key": "outputs/srcA/v01.mp4"},
            {"index": 2, "filename": "v02.mp4", "status": "corrupt",
             "quality": {"vmaf": 10.0}, "key": "outputs/srcA/v02.mp4"}],
         "manifest_key": "outputs/srcA/manifest.json"},
    ]

    src = tmp_path / "in.mp4"
    src.write_bytes(b"SRC")
    events: list[VariantEvent] = []
    out_dir = str(tmp_path / "out")
    runner = RunPodServerlessRunner(store, FakeRunPodClient(chunks))
    result = runner.run(str(src), count=2, out_dir=out_dir, source_id="srcA",
                        on_event=events.append)

    # source uploaded under inputs/<source_id>/<basename>
    assert "inputs/srcA/in.mp4" in store.list_prefix("inputs/srcA/")
    # progress forwarded as VariantEvents tagged with source_id
    assert all(e.source_id == "srcA" for e in events)
    assert {e.status for e in events if e.state == "done"} == {"ok", "corrupt"}
    # variants downloaded to local out_dir, statuses preserved (incl. corrupt)
    assert isinstance(result, SourceResult)
    assert [v.status for v in result.variants] == ["ok", "corrupt"]
    assert all(isinstance(v, VariantResult) for v in result.variants)
    for v in result.variants:
        assert os.path.isfile(v.path) and v.path.startswith(out_dir)
    assert os.path.isfile(result.manifest_path)


def _stage(store, tmp_path, key, body):
    p = tmp_path / "stage" / key.replace("/", "_")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(body)
    store.put(key, str(p))


def test_runner_downloads_when_stream_omits_result_chunk(tmp_path):
    """GPU finished (done events + R2 objects) but RunPod never forwarded the result chunk."""
    store = FakeObjectStore()
    _stage(store, tmp_path, "outputs/srcA/v01.mp4", b"V1")
    _stage(store, tmp_path, "outputs/srcA/manifest.json", b"{}")
    chunks = [
        {"type": "progress", "event": {"index": 1, "state": "done", "status": "ok",
                                       "quality": {"vmaf": 95.0}, "filename": "v01.mp4",
                                       "uniqueness": 0.42, "look_src": None, "look_var": None}},
    ]
    src = tmp_path / "in.mp4"
    src.write_bytes(b"SRC")
    events: list[VariantEvent] = []
    out_dir = str(tmp_path / "out")
    runner = RunPodServerlessRunner(store, FakeRunPodClient(chunks))
    result = runner.run(str(src), count=1, out_dir=out_dir, source_id="srcA",
                        on_event=events.append)
    assert [v.status for v in result.variants] == ["ok"]
    with open(result.variants[0].path, "rb") as f:
        assert f.read() == b"V1"
    assert os.path.isfile(result.manifest_path)


def test_fetch_outputs_matches_basename_when_exact_key_missing(tmp_path):
    store = FakeObjectStore()
    _stage(store, tmp_path, "outputs/srcA/nested/v01.mp4", b"NESTED")
    runner = RunPodServerlessRunner(store, FakeRunPodClient([]))
    out_dir = str(tmp_path / "out")
    got = runner.fetch_outputs("srcA", out_dir, ["v01.mp4"])
    assert got == 1
    with open(os.path.join(out_dir, "v01.mp4"), "rb") as f:
        assert f.read() == b"NESTED"


def test_runner_sends_hq_defaults_in_payload(tmp_path):
    captured = {}

    class CapturingClient:
        def stream_run(self, payload, cancel_token=None):
            captured.update(payload["input"])
            return iter([{"type": "result", "variants": [], "manifest_key": None}])

    store = FakeObjectStore()
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    RunPodServerlessRunner(store, CapturingClient()).run(
        str(src), count=7, out_dir=str(tmp_path / "o"), source_id="s", on_event=lambda e: None)
    assert captured["quality_mode"] == "hq"
    assert captured["preset"] == "medium"
    assert captured["platform"] == "tiktok"
    assert captured["max_regen"] == 1
    assert captured["count"] == 7
    assert captured["source_id"] == "s"
    assert captured["source_key"] == "inputs/s/in.mp4"
    assert captured["allow_creative_escalate"] is False
    assert captured["auto_tune"] is False
    assert captured["uniqueness_target"] == DEFAULT_TARGET
    assert captured["jobs"] == 1


def test_runner_quality_mode_env_fast(tmp_path, monkeypatch):
    captured = {}

    class CapturingClient:
        def stream_run(self, payload, cancel_token=None):
            captured.update(payload["input"])
            return iter([{"type": "result", "variants": [], "manifest_key": None}])

    monkeypatch.setenv("VARIANT_QUALITY_MODE", "fast")
    store = FakeObjectStore()
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    RunPodServerlessRunner(store, CapturingClient()).run(
        str(src), count=1, out_dir=str(tmp_path / "o"), source_id="s",
        on_event=lambda e: None)
    assert captured["quality_mode"] == "fast"
    assert captured["auto_tune"] is True
    assert captured["jobs"] == 1


def test_fast_20_pack_payload_jobs_not_capped_to_studio_cpus(tmp_path, monkeypatch):
    captured = {}

    class CapturingClient:
        def stream_run(self, payload, cancel_token=None):
            captured.update(payload["input"])
            return iter([{"type": "result", "variants": [], "manifest_key": None}])

    monkeypatch.setenv("VARIANT_QUALITY_MODE", "fast")
    monkeypatch.setattr("variant_maker.server.runner.os.cpu_count", lambda: 2)
    store = FakeObjectStore()
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    RunPodServerlessRunner(store, CapturingClient()).run(
        str(src), count=20, out_dir=str(tmp_path / "o"), source_id="s",
        on_event=lambda e: None, quality_mode="fast")
    assert captured["jobs"] == 8


def test_runner_job_quality_mode_hq_overrides_env_fast(tmp_path, monkeypatch):
    captured = {}

    class CapturingClient:
        def stream_run(self, payload, cancel_token=None):
            captured.update(payload["input"])
            return iter([{"type": "result", "variants": [], "manifest_key": None}])

    monkeypatch.setenv("VARIANT_QUALITY_MODE", "fast")
    store = FakeObjectStore()
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    RunPodServerlessRunner(store, CapturingClient()).run(
        str(src), count=1, out_dir=str(tmp_path / "o"), source_id="s",
        on_event=lambda e: None, quality_mode="hq")
    assert captured["quality_mode"] == "hq"
    assert captured["auto_tune"] is False
    assert captured["jobs"] == 1


def test_runner_accepts_allow_creative_escalate(tmp_path):
    captured = {}

    class CapturingClient:
        def stream_run(self, payload, cancel_token=None):
            captured.update(payload["input"])
            return iter([{"type": "result", "variants": [], "manifest_key": None}])

    store = FakeObjectStore()
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    RunPodServerlessRunner(store, CapturingClient()).run(
        str(src), count=1, out_dir=str(tmp_path / "o"), source_id="s",
        on_event=lambda e: None, allow_creative_escalate=False)
    assert captured["allow_creative_escalate"] is False
