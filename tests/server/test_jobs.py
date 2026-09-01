# tests/server/test_jobs.py
import json
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Callable

from tests.server.fakes import FakeRunner
from variant_maker.server.events import VariantEvent
from variant_maker.server.jobs import (
    COPY_FAILED_MSG,
    DEFAULT_GALLERY_KEEP_HOURS,
    Job,
    JobSource,
    JobStore,
    VariantInfo,
    gallery_keep_hours,
    gallery_keep_jobs,
    source_copy_status,
    source_files_ready,
    variant_on_disk,
)
from variant_maker.server.runner import SourceResult, VariantResult
from variant_maker.server.workspace import Workspace


def _store(tmp_path, plan=None):
    return JobStore(Workspace(str(tmp_path)), FakeRunner(plan or {}))


class _PausingRunner:
    """Emits v1 done (with uniqueness), then blocks until released — for mid-job polls."""

    def __init__(self) -> None:
        self.gate = threading.Event()
        self.v1_done = threading.Event()

    def run(self, source_path: str, *, count: int, out_dir: str, source_id: str,
            on_event: Callable[[VariantEvent], None],
            allow_creative_escalate: bool = True, quality_mode: str = "fast",
            cancel_token=None) -> SourceResult:
        os.makedirs(out_dir, exist_ok=True)
        variants = []
        for i in range(1, count + 1):
            if cancel_token is not None and cancel_token.is_set():
                from variant_maker.server.cancel import JobCancelled
                raise JobCancelled()
            fname = f"v{i:02d}.mp4"
            quality = {"vmaf": 95.0, "bits": 27, "passed": True}
            on_event(VariantEvent(source_id=source_id, index=i, state="rendering"))
            on_event(VariantEvent(
                source_id=source_id, index=i, state="done",
                status="ok", quality=quality, filename=fname,
                uniqueness=0.42, uniqueness_status="ok",
                uniqueness_metric="ssim_bits_v1", uniqueness_target=24 / 64,
                escalated=False, preset_used="medium", strength_final=1.0,
            ))
            path = os.path.join(out_dir, fname)
            open(path, "w").close()
            variants.append(VariantResult(
                index=i, filename=fname, status="ok", quality=quality, path=path,
                uniqueness=0.42, uniqueness_status="ok",
                uniqueness_metric="ssim_bits_v1", uniqueness_target=24 / 64,
                preset_used="medium", strength_final=1.0,
            ))
            if i == 1:
                self.v1_done.set()
                while not self.gate.wait(timeout=0.05):
                    if cancel_token is not None and cancel_token.is_set():
                        from variant_maker.server.cancel import JobCancelled
                        raise JobCancelled()
        mpath = os.path.join(out_dir, "manifest.json")
        open(mpath, "w").close()
        return SourceResult(variants=variants, manifest_path=mpath)


def test_progressive_done_carries_uniqueness_before_job_finishes(tmp_path):
    runner = _PausingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=2)
    assert runner.v1_done.wait(timeout=5)
    # Mid-job: first variant must already expose uniqueness for gallery/job poll.
    deadline = time.time() + 2
    while time.time() < deadline and not job.sources[0].variants:
        time.sleep(0.01)
    assert job.sources[0].variants, "progressive done did not record a variant"
    v = job.sources[0].variants[0]
    assert v.uniqueness == 0.42
    assert v.uniqueness_status == "ok"
    assert v.uniqueness_metric == "ssim_bits_v1"
    assert v.uniqueness_target == 24 / 64
    runner.gate.set()
    store.wait(job.job_id, timeout=5)


def test_hydrate_from_disk_resumes_in_flight_job(tmp_path):
    """Studio restart must keep the job id + already-done variants, then finish the pack."""
    store = _store(tmp_path)
    job = store.create_job([("clip.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    meta = os.path.join(str(tmp_path), "jobs", job.job_id, "job.json")
    with open(meta, encoding="utf-8") as f:
        data = json.load(f)
    assert data["state"] == "done"
    data["state"] = "running"
    data["sources"][0]["variants"] = data["sources"][0]["variants"][:1]
    with open(meta, "w", encoding="utf-8") as f:
        json.dump(data, f)

    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job.job_id)
    assert restored is not None
    assert restored.sources[0].variants[0].index == 1
    assert store2.wait(job.job_id, timeout=5)
    assert restored.state == "done"
    assert len(restored.sources[0].variants) == 2


def test_create_job_runs_in_background_and_completes(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x"), ("b.mp4", b"y")], count=3)
    assert job.state in ("running", "done")
    store.wait(job.job_id, timeout=5)
    done = store.get(job.job_id)
    assert done.state == "done"
    assert len(done.sources) == 2
    for s in done.sources:
        assert len(s.variants) == 3
        assert s.requested == 3


def test_delivered_and_shortfall_count_only_ok(tmp_path):
    # variant 2 is best_effort -> delivered 2 of 3, shortfall 1
    store = _store(tmp_path, plan={2: "best_effort"})
    job = store.create_job([("a.mp4", b"x")], count=3)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    assert src.delivered == 2
    assert src.shortfall == 1


def test_events_recorded_per_job(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    states = [e.state for e in store.get(job.job_id).events]
    assert states.count("done") == 2
    assert "rendering" in states


def test_gallery_and_diagnostics_split_by_status(tmp_path):
    store = _store(tmp_path, plan={2: "best_effort"})
    job = store.create_job([("a.mp4", b"x")], count=3)
    store.wait(job.job_id, timeout=5)

    gallery = store.gallery()
    assert len(gallery) == 1
    ok_in_gallery = [v for v in gallery[0].variants if v.status == "ok"]
    assert len(ok_in_gallery) == 2

    diag = store.diagnostics()
    assert len(diag) == 1
    assert diag[0].status == "best_effort"


def test_diagnostics_includes_uniqueness_fail(tmp_path):
    store = _store(tmp_path, plan={2: "uniqueness_fail"})
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    gallery = store.gallery()
    assert [v.status for v in gallery[0].variants if v.status == "ok"] == ["ok"]
    diag = store.diagnostics()
    assert len(diag) == 1
    assert diag[0].status == "uniqueness_fail"
    assert diag[0].uniqueness_status == "below_floor"


def test_find_variant_and_source_file(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"orig-bytes")], count=2)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    vpath = store.find_variant(src.source_id, src.variants[0].filename)
    assert vpath and vpath.endswith(".mp4")
    spath = store.source_file(src.source_id)
    with open(spath, "rb") as f:
        assert f.read() == b"orig-bytes"


def test_find_variant_rejects_path_traversal(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    sid = store.get(job.job_id).sources[0].source_id
    assert store.find_variant(sid, "../../etc/passwd") is None
    assert store.find_variant(sid, "sub/v01.mp4") is None
    assert store.find_variant(sid, "..") is None
    assert store.find_variant(sid, "") is None


def test_regenerate_appends_variants(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    result = store.regenerate(src.source_id, 2)
    assert result is not None
    assert result is src
    assert len(src.variants) == 4
    assert [v.index for v in src.variants] == [1, 2, 3, 4]


def test_create_job_passes_quality_mode_hq_to_runner(tmp_path):
    runner = FakeRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=1, quality_mode="hq")
    store.wait(job.job_id, timeout=5)
    assert runner.last_quality_mode == "hq"
    assert job.quality_mode == "hq"


def test_regenerate_keeps_job_quality_mode(tmp_path):
    runner = FakeRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=1, quality_mode="hq")
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    store.regenerate(src.source_id, 1)
    assert runner.last_quality_mode == "hq"


class _BoomRunner:
    def run(self, source_path, *, count, out_dir, source_id, on_event,
            allow_creative_escalate=True, quality_mode="fast", cancel_token=None):
        on_event(VariantEvent(source_id=source_id, index=1, state="rendering"))
        raise RuntimeError("RunPod job abc ended: FAILED")


def test_cancel_stops_after_first_variant(tmp_path):
    runner = _PausingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=2)
    assert runner.v1_done.wait(timeout=5)
    out = store.cancel(job.job_id)
    assert out is job
    store.wait(job.job_id, timeout=5)
    assert job.state == "cancelled"
    assert "Cancelled" in (job.error or "")
    assert len(job.sources[0].variants) == 1


def test_cancel_unknown_job_is_none(tmp_path):
    store = _store(tmp_path)
    assert store.cancel("nope") is None


def test_runner_crash_marks_done_with_gpu_timeout_copy(tmp_path):
    store = JobStore(Workspace(str(tmp_path)), _BoomRunner())
    job = store.create_job([("a.mp4", b"x")], count=1, quality_mode="hq")
    store.wait(job.job_id, timeout=5)
    assert job.state == "done"
    assert job.error is not None
    assert "20 minutes" in job.error
    assert "New run" in job.error
    assert job.sources[0].delivered == 0


def test_copy_status_is_disk_only(tmp_path):
    """Metadata can say ok while the mp4 is gone — Gallery must not trust delivered."""
    ws = Workspace(str(tmp_path))
    source = JobSource(
        source_id="src1", filename="a.mp4", requested=2,
        variants=[
            VariantInfo(source_id="src1", index=1, filename="v01.mp4",
                        status="ok", quality={"vmaf": 95.0}),
            VariantInfo(source_id="src1", index=2, filename="v02.mp4",
                        status="ok", quality={"vmaf": 95.0}),
        ],
    )
    assert source.delivered == 2
    assert source_files_ready(source, ws, "job1") == 0
    assert source_copy_status(source, ws, "job1", "done") == "missing"
    assert source_copy_status(source, ws, "job1", "running") == "copying"

    out = ws.source_out_dir("job1", "src1")
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "v01.mp4"), "w").close()
    open(os.path.join(out, "v02.mp4"), "w").close()
    assert variant_on_disk(ws, "job1", "src1", "v01.mp4")
    assert source_files_ready(source, ws, "job1") == 2
    assert source_copy_status(source, ws, "job1", "done") == "ok"


class _MetaOnlyRunner:
    """GPU-style: events + result metadata, no files written (copy never landed)."""

    def run(self, source_path, *, count, out_dir, source_id, on_event,
            allow_creative_escalate=True, quality_mode="fast", cancel_token=None):
        os.makedirs(out_dir, exist_ok=True)
        variants = []
        for i in range(1, count + 1):
            fname = f"v{i:02d}.mp4"
            quality = {"vmaf": 95.0, "passed": True}
            on_event(VariantEvent(
                source_id=source_id, index=i, state="done",
                status="ok", quality=quality, filename=fname,
            ))
            variants.append(VariantResult(
                index=i, filename=fname, status="ok", quality=quality,
                path=os.path.join(out_dir, fname),
            ))
        return SourceResult(variants=variants, manifest_path=os.path.join(out_dir, "manifest.json"))

    def fetch_outputs(self, source_id, out_dir, filenames):
        return 0


def test_job_errors_when_ok_metadata_has_no_files(tmp_path):
    store = JobStore(Workspace(str(tmp_path)), _MetaOnlyRunner())
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    assert job.state == "done"
    assert job.sources[0].delivered == 2
    assert job.error == COPY_FAILED_MSG
    assert source_files_ready(job.sources[0], store._ws, job.job_id) == 0


def test_retry_copy_pulls_missing_and_clears_copy_error(tmp_path):
    from tests.server.fakes import FakeObjectStore, FakeRunPodClient
    from variant_maker.server.runpod_runner import RunPodServerlessRunner

    blobstore = FakeObjectStore()
    ws = Workspace(str(tmp_path))
    runner = RunPodServerlessRunner(blobstore, FakeRunPodClient([]))
    store = JobStore(ws, runner)
    job_id, source_id = "jobretry01", "srcretry01"
    out_dir = ws.source_out_dir(job_id, source_id)
    os.makedirs(out_dir, exist_ok=True)
    staged = tmp_path / "staged.mp4"
    staged.write_bytes(b"RETRY-COPY-BYTES")
    blobstore.put(f"outputs/{source_id}/v01.mp4", str(staged))

    job = Job(
        job_id=job_id, count=1, created_utc="2026-08-18T00:00:00Z",
        sources=[JobSource(
            source_id=source_id, filename="clip.mp4", requested=1,
            variants=[VariantInfo(
                source_id=source_id, index=1, filename="v01.mp4", status="ok",
                quality={"vmaf": 99.0},
            )],
        )],
        state="done", error=COPY_FAILED_MSG,
    )
    store._install_hydrated_job(job)
    # hydrate already pulls — wipe the copy so retry-copy is the path under test
    os.remove(os.path.join(out_dir, "v01.mp4"))
    assert source_files_ready(job.sources[0], ws, job_id) == 0

    out = store.retry_copy(source_id)
    assert out is job.sources[0]
    assert source_files_ready(job.sources[0], ws, job_id) == 1
    assert job.error is None
    assert store.retry_copy("nope") is None


def test_delete_source_drops_pack_from_gallery_and_disk(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    sid = job.sources[0].source_id
    job_dir = os.path.join(str(tmp_path), "jobs", job.job_id)
    assert os.path.isdir(job_dir)
    assert store.delete_source(sid) is True
    assert store.gallery() == []
    assert store.get(job.job_id) is None
    assert not os.path.isdir(job_dir)
    assert store.delete_source(sid) is False
    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 0


def test_delete_one_source_keeps_sibling(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x"), ("b.mp4", b"y")], count=1)
    store.wait(job.job_id, timeout=5)
    first, second = job.sources[0].source_id, job.sources[1].source_id
    assert store.delete_source(first) is True
    assert [s.source_id for s in store.gallery()] == [second]
    assert store.get(job.job_id) is not None
    assert os.path.isfile(os.path.join(str(tmp_path), "jobs", job.job_id, "job.json"))


def test_delete_running_source_cancels_and_does_not_resurrect(tmp_path):
    runner = _PausingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=2)
    assert runner.v1_done.wait(timeout=5)
    sid = job.sources[0].source_id
    job_id = job.job_id
    assert store.delete_source(sid) is True
    store.wait(job_id, timeout=5)
    time.sleep(0.15)
    assert store.get(job_id) is None
    assert store.gallery() == []
    assert not os.path.isdir(os.path.join(str(tmp_path), "jobs", job_id))


class _HoldRunner:
    """Starts two sources in parallel and holds until released — isolation + queue."""

    def __init__(self) -> None:
        self.started: list[tuple[str, str]] = []
        self.gate = threading.Event()
        self._lock = threading.Lock()
        self.started_n = threading.Event()

    def run(self, source_path: str, *, count: int, out_dir: str, source_id: str,
            on_event: Callable[[VariantEvent], None],
            allow_creative_escalate: bool = True, quality_mode: str = "fast",
            cancel_token=None) -> SourceResult:
        os.makedirs(out_dir, exist_ok=True)
        with self._lock:
            self.started.append((source_path, out_dir))
            if len(self.started) >= 2:
                self.started_n.set()
        fname = "v01.mp4"
        quality = {"vmaf": 95.0, "passed": True}
        on_event(VariantEvent(
            source_id=source_id, index=1, state="done",
            status="ok", quality=quality, filename=fname,
        ))
        open(os.path.join(out_dir, fname), "w").close()
        while not self.gate.wait(timeout=0.05):
            if cancel_token is not None and cancel_token.is_set():
                from variant_maker.server.cancel import JobCancelled
                raise JobCancelled()
        mpath = os.path.join(out_dir, "manifest.json")
        open(mpath, "w").close()
        return SourceResult(
            variants=[VariantResult(
                index=1, filename=fname, status="ok", quality=quality,
                path=os.path.join(out_dir, fname),
            )],
            manifest_path=mpath,
        )


def test_two_jobs_use_separate_folders_and_cancel_is_per_job(tmp_path):
    """Shared Studio URL: two Generates must not mix files or cancel each other."""
    from variant_maker.server.jobs import queue_snapshot

    runner = _HoldRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    a = store.create_job([("va.mp4", b"aaa")], count=1, quality_mode="fast")
    b = store.create_job([("partner.mp4", b"bbb")], count=1, quality_mode="hq")
    assert runner.started_n.wait(timeout=5)
    paths_a = store._ws.source_in_path(a.job_id, a.sources[0].source_id, "va.mp4")
    paths_b = store._ws.source_in_path(b.job_id, b.sources[0].source_id, "partner.mp4")
    assert os.path.isfile(paths_a) and os.path.isfile(paths_b)
    assert os.path.dirname(os.path.dirname(paths_a)) != os.path.dirname(os.path.dirname(paths_b))
    with open(paths_a, "rb") as f:
        assert f.read() == b"aaa"
    with open(paths_b, "rb") as f:
        assert f.read() == b"bbb"
    out_dirs = {out for _, out in runner.started}
    assert len(out_dirs) == 2

    snap = queue_snapshot(store.list())
    assert snap["running"] == 2
    assert snap["fast"] == 1 and snap["hq"] == 1
    assert [j["position"] for j in snap["jobs"]] == [1, 2]
    names = {tuple(j["filenames"]) for j in snap["jobs"]}
    assert names == {("va.mp4",), ("partner.mp4",)}
    assert all("file_url" not in j for j in snap["jobs"])

    store.cancel(a.job_id)
    assert store.wait(a.job_id, timeout=5)
    assert a.state == "cancelled"
    assert store.get(b.job_id).state == "running"
    snap = queue_snapshot(store.list())
    assert snap["running"] == 1
    assert snap["jobs"][0]["job_id"] == b.job_id

    runner.gate.set()
    assert store.wait(b.job_id, timeout=5)
    assert b.state == "done"
    assert queue_snapshot(store.list())["running"] == 0


def test_set_post_url_survives_hydrate(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    url = "https://www.instagram.com/reel/Hydrate1/"
    updated = store.set_post_url(src.source_id, src.variants[0].index, url)
    assert updated is not None
    assert updated.post_url == url

    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job.job_id).sources[0].variants[0]
    assert restored.post_url == url
    assert restored.platform_result is None


def test_set_caption_survives_hydrate(tmp_path):
    store = _store(tmp_path)
    job = store.create_job(
        [("boil.mp4", b"x")], count=2, generate_captions=True, caption_prompt="POV boil #reels",
    )
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    index = src.variants[0].index
    updated = store.set_caption(src.source_id, index, "Wait — the boil hits different\n#reels")
    assert updated is not None
    assert "hits different" in (updated.caption or "")

    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job.job_id).sources[0]
    assert "hits different" in (restored.variants[0].caption or "")
    assert restored.planned_captions[index - 1] == restored.variants[0].caption


def test_set_caption_strips_copy_n_of_m(tmp_path):
    store = _store(tmp_path)
    job = store.create_job([("boil.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    updated = store.set_caption(
        src.source_id, src.variants[0].index, "POV boil\n\nCopy 1 of 20\n#reels",
    )
    assert updated is not None
    assert updated.caption == "POV boil\n\n#reels"
    assert "copy 1 of" not in (updated.caption or "").lower()


def test_rewrite_captions_replaces_every_copy(tmp_path):
    store = _store(tmp_path)
    job = store.create_job(
        [("boil.mp4", b"x")], count=2, generate_captions=True, caption_prompt="POV boil #reels",
    )
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    rewritten = store.rewrite_captions(src.source_id, "Gym pump #fyp")
    assert rewritten is not None
    assert rewritten.caption_prompt == "Gym pump #fyp"
    caps = [v.caption or "" for v in rewritten.variants]
    assert all(caps)
    assert caps[0] != caps[1]
    joined = "\n".join(caps).lower()
    assert "gym" in joined or "pump" in joined
    assert "copy 1 of" not in joined


def test_gallery_keep_boots_oldest_finished_job(tmp_path):
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}), gallery_keep_jobs=2,
        gallery_keep_hours=0,
    )
    ids = []
    for name in ("a.mp4", "b.mp4", "c.mp4"):
        job = store.create_job([(name, b"x")], count=1)
        assert store.wait(job.job_id, timeout=5)
        ids.append(job.job_id)
    assert store.get(ids[0]) is None
    assert not os.path.isdir(os.path.join(str(tmp_path), "jobs", ids[0]))
    assert store.get(ids[1]) is not None
    assert store.get(ids[2]) is not None
    assert len(store.list()) == 2


def test_gallery_keep_does_not_delete_a_running_job(tmp_path):
    runner = _PausingRunner()
    store = JobStore(
        Workspace(str(tmp_path)), runner, gallery_keep_jobs=1,
        gallery_keep_hours=0,
    )
    live = store.create_job([("live.mp4", b"x")], count=2)
    assert runner.v1_done.wait(timeout=5)
    # same store: finish two more jobs while live is held
    store._runner = FakeRunner({})
    a = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(a.job_id, timeout=5)
    b = store.create_job([("b.mp4", b"x")], count=1)
    assert store.wait(b.job_id, timeout=5)
    assert store.get(live.job_id) is not None
    assert live.state == "running"
    assert store.get(a.job_id) is None
    assert store.get(b.job_id) is not None
    runner.gate.set()
    assert store.wait(live.job_id, timeout=5)
    # three finished → keep 1 newest (live, last to finish) unless created_utc
    # orders live first. Live was created first so it is the oldest finished
    # after it completes — keep the newest finished job (b).
    remaining = [j.job_id for j in store.list() if j.state != "running"]
    assert live.job_id not in remaining
    assert b.job_id in remaining
    assert len(remaining) == 1


def test_gallery_keep_jobs_env_default_and_disable(monkeypatch):
    monkeypatch.delenv("VARIANT_GALLERY_KEEP_JOBS", raising=False)
    assert gallery_keep_jobs() == 0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_JOBS", "0")
    assert gallery_keep_jobs() == 0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_JOBS", "7")
    assert gallery_keep_jobs() == 7
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_JOBS", "nope")
    assert gallery_keep_jobs() == 0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_JOBS", "-3")
    assert gallery_keep_jobs() == 0


def test_gallery_keep_hours_env_default_and_disable(monkeypatch):
    monkeypatch.delenv("VARIANT_GALLERY_KEEP_HOURS", raising=False)
    assert gallery_keep_hours() == 168.0
    assert DEFAULT_GALLERY_KEEP_HOURS == 168.0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_HOURS", "0")
    assert gallery_keep_hours() == 0.0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_HOURS", "12")
    assert gallery_keep_hours() == 12.0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_HOURS", "nope")
    assert gallery_keep_hours() == 168.0
    monkeypatch.setenv("VARIANT_GALLERY_KEEP_HOURS", "-3")
    assert gallery_keep_hours() == 0.0


def test_jobstore_default_keep_hours_is_seven_days(monkeypatch, tmp_path):
    monkeypatch.delenv("VARIANT_GALLERY_KEEP_HOURS", raising=False)
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store._keep_hours == 168.0


def test_hydrate_prunes_to_gallery_keep(tmp_path):
    seed = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}), gallery_keep_jobs=0,
        gallery_keep_hours=0,
    )
    ids = []
    for name in ("a.mp4", "b.mp4", "c.mp4", "d.mp4"):
        job = seed.create_job([(name, b"x")], count=1)
        assert seed.wait(job.job_id, timeout=5)
        ids.append(job.job_id)
    assert len(seed.list()) == 4
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}), gallery_keep_jobs=2,
        gallery_keep_hours=0,
    )
    store.hydrate_from_disk()
    assert store.get(ids[0]) is None
    assert store.get(ids[1]) is None
    assert store.get(ids[2]) is not None
    assert store.get(ids[3]) is not None
    assert not os.path.isdir(os.path.join(str(tmp_path), "jobs", ids[0]))


def test_gallery_age_keeps_twelve_recent_finished_jobs(tmp_path):
    """Failed retries in a busy day must not boot a good pack (no count cap)."""
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=24,
    )
    ids = []
    for i in range(12):
        job = store.create_job([(f"c{i:02d}.mp4", b"x")], count=1)
        assert store.wait(job.job_id, timeout=5)
        ids.append(job.job_id)
    assert all(store.get(jid) is not None for jid in ids)
    assert len(store.list()) == 12


def test_gallery_age_prunes_finished_job_after_24h(tmp_path, monkeypatch):
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=24,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(job.job_id, timeout=5)
    job_id = job.job_id
    job_dir = os.path.join(str(tmp_path), "jobs", job_id)
    assert store.get(job_id) is not None
    assert os.path.isdir(job_dir)

    clock["now"] = t0 + timedelta(hours=25)
    store.prune_finished_jobs()
    assert store.get(job_id) is None
    assert not os.path.isdir(job_dir)


def test_gallery_age_keeps_finished_job_inside_7d(tmp_path, monkeypatch):
    """Post tracking: a pack from yesterday must still be on the Gallery row."""
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=168,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(job.job_id, timeout=5)

    clock["now"] = t0 + timedelta(hours=25)
    store.prune_finished_jobs()
    assert store.get(job.job_id) is not None
    assert os.path.isdir(os.path.join(str(tmp_path), "jobs", job.job_id))


def test_gallery_age_prunes_finished_job_after_7d(tmp_path, monkeypatch):
    """Day 8 drops off the Gallery row."""
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=168,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(job.job_id, timeout=5)
    job_id = job.job_id
    job_dir = os.path.join(str(tmp_path), "jobs", job_id)

    clock["now"] = t0 + timedelta(days=7)
    store.prune_finished_jobs()
    assert store.get(job_id) is not None

    clock["now"] = t0 + timedelta(days=8)
    store.prune_finished_jobs()
    assert store.get(job_id) is None
    assert not os.path.isdir(job_dir)


def test_gallery_age_keeps_finished_job_inside_24h(tmp_path, monkeypatch):
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=24,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(job.job_id, timeout=5)

    clock["now"] = t0 + timedelta(hours=1)
    store.prune_finished_jobs()
    assert store.get(job.job_id) is not None
    assert os.path.isdir(os.path.join(str(tmp_path), "jobs", job.job_id))


def test_gallery_age_does_not_delete_a_running_job(tmp_path, monkeypatch):
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    runner = _PausingRunner()
    store = JobStore(
        Workspace(str(tmp_path)), runner,
        gallery_keep_jobs=0, gallery_keep_hours=24,
    )
    live = store.create_job([("live.mp4", b"x")], count=2)
    assert runner.v1_done.wait(timeout=5)
    job_dir = os.path.join(str(tmp_path), "jobs", live.job_id)

    clock["now"] = t0 + timedelta(hours=25)
    store.prune_finished_jobs()
    assert store.get(live.job_id) is not None
    assert live.state == "running"
    assert os.path.isdir(job_dir)

    runner.gate.set()
    assert store.wait(live.job_id, timeout=5)


def test_gallery_list_prunes_aged_finished_job(tmp_path, monkeypatch):
    t0 = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)
    clock = {"now": t0}
    monkeypatch.setattr("variant_maker.server.jobs._utc_now", lambda: clock["now"])
    store = JobStore(
        Workspace(str(tmp_path)), FakeRunner({}),
        gallery_keep_jobs=0, gallery_keep_hours=24,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    assert store.wait(job.job_id, timeout=5)
    job_id = job.job_id
    job_dir = os.path.join(str(tmp_path), "jobs", job_id)
    assert store.get(job_id) is not None

    clock["now"] = t0 + timedelta(hours=25)
    remaining = store.list()
    assert remaining == []
    assert store.get(job_id) is None
    assert not os.path.isdir(job_dir)


def test_delete_job_drops_r2_prefixes(tmp_path):
    from tests.server.fakes import FakeObjectStore

    objects = FakeObjectStore()
    blob = tmp_path / "blob.bin"
    blob.write_bytes(b"x")
    store = JobStore(
        Workspace(str(tmp_path / "ws")), FakeRunner({}), object_store=objects,
        gallery_keep_jobs=0,
    )
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    sid = job.sources[0].source_id
    objects.put(f"inputs/{sid}/a.mp4", str(blob))
    objects.put(f"outputs/{sid}/v01.mp4", str(blob))
    objects.put("outputs/other/v01.mp4", str(blob))
    assert store.delete_job(job.job_id) is True
    assert objects.list_prefix(f"inputs/{sid}/") == []
    assert objects.list_prefix(f"outputs/{sid}/") == []
    assert objects.list_prefix("outputs/other/") == ["outputs/other/v01.mp4"]


def test_create_job_generate_captions_is_unique_per_index(tmp_path):
    store = _store(tmp_path)
    job = store.create_job(
        [("boil.mp4", b"x")], count=2, generate_captions=True, caption_prompt="POV boil #reels",
    )
    store.wait(job.job_id, timeout=5)
    done = store.get(job.job_id)
    caps = [v.caption for v in done.sources[0].variants]
    assert caps[0] and caps[1]
    assert caps[0] != caps[1]
    joined = "\n".join(caps).lower()
    assert "copy 1 of" not in joined
    assert "copy 2 of" not in joined


def test_create_job_caption_prompts_are_per_source(tmp_path):
    store = _store(tmp_path)
    job = store.create_job(
        [("boil.mp4", b"x"), ("gym.mp4", b"y")],
        count=1,
        generate_captions=True,
        caption_prompts=["POV boil #reels", "Gym pull up #fyp"],
    )
    store.wait(job.job_id, timeout=5)
    done = store.get(job.job_id)
    boil = done.sources[0].planned_captions
    gym = done.sources[1].planned_captions
    assert boil and "boil" in boil[0].lower()
    assert gym and "gym" in gym[0].lower()
    assert "copy 1 of" not in boil[0].lower()
