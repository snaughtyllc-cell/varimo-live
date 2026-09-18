import json
import threading
import time

from farm_fakes import FakeDrive
from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.cancel import JobCancelled
from variant_maker.server.destinations import DestinationStore
from variant_maker.server.drive_exports import (
    ExportStore,
    bind_studio_export,
    refs_for_finished_job,
    start_job_export,
)
from variant_maker.server.jobs import Job, JobSource, JobStore, VariantInfo
from variant_maker.server.workspace import Workspace


def _sa(tmp_path):
    sa_path = tmp_path / "sa.json"
    sa_path.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    return str(sa_path)


def _client(tmp_path, drive=None, store=None):
    ws_store = store or JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    client = TestClient(
        create_app(ws_store, drive=drive or FakeDrive(), sa_json_path=_sa(tmp_path)),
    )
    return client, ws_store


def _landed(drive, folder):
    return [n for n in drive._nodes.values() if n["parent"] == folder and n["blob"]]


def _wait_landed(drive, folder, timeout=3):
    deadline = time.time() + timeout
    landed = []
    while time.time() < deadline:
        landed = _landed(drive, folder)
        if landed:
            return landed
        time.sleep(0.05)
    return landed


def test_refs_for_finished_job_uses_captions_and_skips_fails():
    job = Job(job_id="j1", count=3, created_utc="2026-01-01T00:00:00Z", state="done")
    src = JobSource(source_id="s1", filename="a.mp4", requested=3, planned_captions=["one", "two", "three"])
    src.variants = [
        VariantInfo(source_id="s1", index=1, filename="v01.mp4", status="ok", quality={}, caption="one"),
        VariantInfo(source_id="s1", index=2, filename="v02.mp4", status="uniqueness_fail", quality={}),
        VariantInfo(source_id="s1", index=3, filename="v03.mp4", status="best_effort", quality={}, caption="three"),
    ]
    job.sources.append(src)
    refs = refs_for_finished_job(job)
    assert [(r.index, r.caption) for r in refs] == [(1, "one"), (3, "three")]


def test_start_job_export_uploads_shipped_variants(tmp_path):
    from pathlib import Path

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = Job(
        job_id="j1",
        count=1,
        created_utc="2026-01-01T00:00:00Z",
        state="done",
        export_destination_id="dst_out",
    )
    src = JobSource(source_id="s1", filename="a.mp4", requested=1)
    out = Path(ws.source_out_dir("j1", "s1"))
    (out / "v01.mp4").write_bytes(b"video-bytes")
    src.variants.append(VariantInfo(
        source_id="s1", index=1, filename="v01.mp4", status="ok", quality={"vmaf": 95},
    ))
    job.sources.append(src)
    store._jobs["j1"] = job
    store._source_index["s1"] = ("j1", src)

    drive = FakeDrive()
    folder = drive.make_folder("out")
    dests = DestinationStore(ws.destinations_path())
    dest = dests.create(name="Reels out", folder_id=folder, auth_mode="oauth")
    export = start_job_export(
        job=job,
        job_store=store,
        dest=dest,
        export_store=ExportStore(ws.exports_dir()),
        drive=drive,
    )
    assert export is not None
    landed = _wait_landed(drive, folder)
    assert [n["name"] for n in landed] == ["v01.mp4"]


def test_create_job_exports_to_picked_folder_when_done(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, store = _client(tmp_path, drive=drive)
    dest = client.app.state.destinations.create(
        name="Reels out", folder_id=folder, auth_mode="oauth",
    )
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "export_destination_id": dest.id},
    )
    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    assert store.wait(job_id, timeout=5)
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["export_destination_id"] == dest.id
    landed = _wait_landed(drive, folder)
    assert landed, "finished pack should land in the picked Drive folder"
    assert any(n["name"].endswith(".mp4") for n in landed)


def test_create_job_unknown_export_folder_is_404(tmp_path):
    client, _ = _client(tmp_path)
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "export_destination_id": "dst_missing"},
    )
    assert resp.status_code == 404


def test_from_drive_job_exports_to_picked_output_folder(tmp_path):
    drive = FakeDrive()
    inbox = drive.make_folder("inbox")
    out = drive.make_folder("out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video-bytes")
    fid = drive.put_file("clip.mp4", str(clip), parent=inbox)
    client, store = _client(tmp_path, drive=drive)
    inbox_dest = client.app.state.destinations.create(
        name="Inbox", folder_id=inbox, auth_mode="oauth",
    )
    out_dest = client.app.state.destinations.create(
        name="Out", folder_id=out, auth_mode="oauth",
    )
    resp = client.post("/api/jobs/from-drive", json={
        "destination_id": inbox_dest.id,
        "file_ids": [fid],
        "count": 1,
        "export_destination_id": out_dest.id,
    })
    assert resp.status_code == 201
    assert store.wait(resp.json()["job_id"], timeout=5)
    landed = _wait_landed(drive, out)
    assert any(n["name"].endswith(".mp4") for n in landed)


def test_create_job_without_output_folder_does_not_export(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, store = _client(tmp_path, drive=drive)
    client.app.state.destinations.create(name="Reels out", folder_id=folder, auth_mode="oauth")
    before = {fid for fid, n in drive._nodes.items() if n["blob"]}
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1"},
    )
    assert resp.status_code == 201
    assert store.wait(resp.json()["job_id"], timeout=5)
    time.sleep(0.2)
    after = {fid for fid, n in drive._nodes.items() if n["blob"]}
    assert after == before


def test_create_job_picked_folder_requires_drive(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    dest = DestinationStore(ws.destinations_path()).create(
        name="Out", folder_id="folder1", auth_mode="oauth",
    )
    client = TestClient(create_app(
        store, drive=None, sa_json_path="", oauth_environ={}, auth_environ={},
    ))
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "export_destination_id": dest.id},
    )
    assert resp.status_code == 503


def test_from_uploads_exports_to_picked_folder(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, store = _client(tmp_path, drive=drive)
    dest = client.app.state.destinations.create(
        name="Reels out", folder_id=folder, auth_mode="oauth",
    )
    payload = b"fake-video-bytes"
    init = client.post("/api/uploads", data={"filename": "clip.mp4", "size": str(len(payload))})
    upload_id = init.json()["upload_id"]
    assert client.put(f"/api/uploads/{upload_id}?offset=0", content=payload).status_code == 200
    resp = client.post(
        "/api/jobs/from-uploads",
        data={
            "upload_ids": upload_id,
            "count": "1",
            "export_destination_id": dest.id,
        },
    )
    assert resp.status_code == 201
    assert store.wait(resp.json()["job_id"], timeout=5)
    assert _wait_landed(drive, folder)


def test_export_destination_survives_job_json(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job(
        [("a.mp4", b"x")], count=1, export_destination_id="dst_out",
    )
    store.wait(job.job_id, timeout=5)
    path = ws.job_meta_path(job.job_id)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    assert data["export_destination_id"] == "dst_out"
    store2 = JobStore(ws, FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job.job_id)
    assert restored is not None
    assert restored.export_destination_id == "dst_out"
    assert restored.state == "done"


def test_cancelled_job_does_not_export(tmp_path):
    class BlockingRunner:
        def __init__(self):
            self.started = threading.Event()
            self.release = threading.Event()

        def run(self, source_path, *, count, out_dir, source_id, on_event,
                allow_creative_escalate=True, quality_mode="fast", cancel_token=None):
            self.started.set()
            self.release.wait(timeout=5)
            raise JobCancelled()

    drive = FakeDrive()
    folder = drive.make_folder("out")
    ws = Workspace(str(tmp_path))
    runner = BlockingRunner()
    store = JobStore(ws, runner)
    dests = DestinationStore(ws.destinations_path())
    dest = dests.create(name="Reels out", folder_id=folder, auth_mode="oauth")
    client, store = _client(tmp_path, drive=drive, store=store)
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "export_destination_id": dest.id},
    )
    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    assert runner.started.wait(timeout=2)
    cancel = client.post(f"/api/jobs/{job_id}/cancel")
    assert cancel.status_code == 200
    runner.release.set()
    assert store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None and job.state == "cancelled"
    time.sleep(0.2)
    assert _landed(drive, folder) == []


def test_bind_skips_missing_folder_without_failing(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    dests = DestinationStore(ws.destinations_path())
    exports = ExportStore(ws.exports_dir())
    drive = FakeDrive()
    bind_studio_export(store, dests, exports, lambda: drive)
    job = Job(
        job_id="j1",
        count=1,
        created_utc="2026-01-01T00:00:00Z",
        state="done",
        export_destination_id="dst_gone",
    )
    store.on_job_done(job)
    assert exports.list() == []


def test_bind_skips_cancelled_job(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    dests = DestinationStore(ws.destinations_path())
    dest = dests.create(name="Out", folder_id="f1", auth_mode="oauth")
    exports = ExportStore(ws.exports_dir())
    drive = FakeDrive()
    bind_studio_export(store, dests, exports, lambda: drive)
    job = Job(
        job_id="j1",
        count=1,
        created_utc="2026-01-01T00:00:00Z",
        state="cancelled",
        export_destination_id=dest.id,
    )
    store.on_job_done(job)
    assert exports.list() == []


def test_restart_resumes_running_job_and_still_exports(tmp_path):
    """A deploy mid-generate must attach the upload hook before resume finishes."""
    drive = FakeDrive()
    folder = drive.make_folder("out")
    ws = Workspace(str(tmp_path))
    first = JobStore(ws, FakeRunner({}))
    dest = DestinationStore(ws.destinations_path()).create(
        name="Reels out", folder_id=folder, auth_mode="oauth",
    )
    job = first.create_job(
        [("a.mp4", b"x")], count=1, export_destination_id=dest.id,
    )
    first.wait(job.job_id, timeout=5)
    meta = ws.job_meta_path(job.job_id)
    with open(meta, encoding="utf-8") as fh:
        data = json.load(fh)
    data["state"] = "running"
    data["sources"][0]["variants"] = []
    with open(meta, "w", encoding="utf-8") as fh:
        json.dump(data, fh)

    resumed = JobStore(ws, FakeRunner({}))
    client, store = _client(tmp_path, drive=drive, store=resumed)
    assert store.wait(job.job_id, timeout=5)
    detail = client.get(f"/api/jobs/{job.job_id}").json()
    assert detail["export_destination_id"] == dest.id
    assert detail["state"] == "done"
    assert _wait_landed(drive, folder)
