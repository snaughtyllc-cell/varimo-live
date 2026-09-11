import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from farm_fakes import FakeDrive
from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.drive_exports import (
    ExportError,
    ExportRunner,
    ExportStore,
    VariantRef,
    build_export_files,
)
from variant_maker.server.jobs import Job, JobSource, JobStore, VariantInfo
from variant_maker.server.workspace import Workspace


def _store_with_ok(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    # manually seed a done job with one ok variant on disk
    job = Job(job_id="j1", count=1, created_utc="2026-01-01T00:00:00Z", state="done")
    src = JobSource(source_id="s1", filename="a.mp4", requested=1)
    out = ws.source_out_dir("j1", "s1")
    path = Path(out) / "v01.mp4"
    path.write_bytes(b"video-bytes")
    src.variants.append(VariantInfo(
        source_id="s1", index=1, filename="v01.mp4", status="ok", quality={"vmaf": 95},
    ))
    job.sources.append(src)
    store._jobs["j1"] = job
    store._source_index["s1"] = ("j1", src)
    return store, ws


def test_build_export_files_filters_non_ok(tmp_path):
    store, ws = _store_with_ok(tmp_path)
    job = store.get("j1")
    be_path = Path(ws.source_out_dir("j1", "s1")) / "v02.mp4"
    be_path.write_bytes(b"best-effort-bytes")
    job.sources[0].variants.append(VariantInfo(
        source_id="s1", index=2, filename="v02.mp4", status="best_effort", quality={},
    ))
    job.sources[0].variants.append(VariantInfo(
        source_id="s1", index=3, filename="v03.mp4", status="uniqueness_fail", quality={"bits": 12},
    ))
    files = build_export_files(store, [VariantRef("s1", 1), VariantRef("s1", 2), VariantRef("s1", 3)])
    assert [f.filename for f in files] == ["v01.mp4", "v02.mp4"]


def test_build_export_files_uses_caption_as_drive_name(tmp_path):
    store, _ = _store_with_ok(tmp_path)
    files = build_export_files(
        store, [VariantRef("s1", 1, caption="POV: she said #reels")],
    )
    assert files[0].filename == "POV: she said #reels.mp4"


def test_build_export_files_empty_raises(tmp_path):
    store, _ = _store_with_ok(tmp_path)
    with pytest.raises(ExportError, match="No ok videos"):
        build_export_files(store, [VariantRef("s1", 2)])  # missing index


def test_runner_still_uploads_when_tenant_context_drops(tmp_path):
    """Send to Drive starts a daemon thread. That thread has no request tenant.

    If the runner keeps an AttrProxy store, get() looks in the empty fallback
    and the job stays running with every file pending (0 / 20 forever).
    """
    from types import SimpleNamespace

    from variant_maker.server.auth_app import AttrProxy, tenant_cv

    store, ws = _store_with_ok(tmp_path)
    drive = FakeDrive()
    folder = drive.make_folder("out")
    tenant_exports = ExportStore(ws.exports_dir())
    fallback = ExportStore(str(tmp_path / "fallback-exports"))
    proxy = AttrProxy("exports", fallback)
    files = build_export_files(store, [VariantRef("s1", 1)])
    token = tenant_cv.set(SimpleNamespace(exports=tenant_exports))
    try:
        job = proxy.create(destination_id="dst_x", folder_id=folder, files=files)
        ExportRunner(drive, proxy).start(job)
    finally:
        tenant_cv.reset(token)
    for _ in range(50):
        job = tenant_exports.get(job.export_id)
        if job.state in ("succeeded", "partial", "failed"):
            break
        time.sleep(0.05)
    assert job.state == "succeeded", job.state
    assert job.files[0].status == "succeeded"
    assert fallback.get(job.export_id) is None


def test_runner_uploads_and_suffixes_collision(tmp_path):
    store, ws = _store_with_ok(tmp_path)
    drive = FakeDrive()
    folder = drive.make_folder("out")
    # existing collision
    p = tmp_path / "pre.mp4"
    p.write_bytes(b"old")
    drive.upload(str(p), folder, name="v01.mp4")
    exports = ExportStore(ws.exports_dir())
    files = build_export_files(store, [VariantRef("s1", 1)])
    job = exports.create(destination_id="dst_x", folder_id=folder, files=files)
    ExportRunner(drive, exports).start(job)
    for _ in range(50):
        job = exports.get(job.export_id)
        if job.state in ("succeeded", "partial", "failed"):
            break
        time.sleep(0.05)
    assert job.state == "succeeded"
    names = {f.name for f in drive.list_files(folder)}
    assert "v01 (1).mp4" in names
    assert job.files[0].drive_file_id


def test_partial_failure_and_retry(tmp_path):
    store, ws = _store_with_ok(tmp_path)
    # add second ok file
    out = ws.source_out_dir("j1", "s1")
    Path(out, "v02.mp4").write_bytes(b"v2")
    store.get("j1").sources[0].variants.append(VariantInfo(
        source_id="s1", index=2, filename="v02.mp4", status="ok", quality={"vmaf": 90},
    ))
    drive = FakeDrive()
    folder = drive.make_folder("out")
    exports = ExportStore(ws.exports_dir())
    files = build_export_files(store, [VariantRef("s1", 1), VariantRef("s1", 2)])
    job = exports.create(destination_id="dst_x", folder_id=folder, files=files)

    class FlakyDrive:
        def __init__(self, inner):
            self._inner = inner
            self._fail_once = {"v01.mp4"}

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def upload(self, local_path, parent_id, name=None):
            n = name or Path(local_path).name
            if n in self._fail_once:
                self._fail_once.discard(n)
                raise RuntimeError("quota exceeded")
            return self._inner.upload(local_path, parent_id, name)

    runner = ExportRunner(FlakyDrive(drive), exports)
    runner.start(job)
    for _ in range(50):
        job = exports.get(job.export_id)
        if job.state in ("succeeded", "partial", "failed"):
            break
        time.sleep(0.05)
    assert job.state == "partial"
    assert sum(1 for f in job.files if f.status == "failed") == 1
    job = runner.retry_failed(job.export_id)
    for _ in range(50):
        job = exports.get(job.export_id)
        if job.state == "succeeded":
            break
        time.sleep(0.05)
    assert job.state == "succeeded"
    assert all(f.status == "succeeded" for f in job.files)


def _export_app(tmp_path, drive=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    sa_path = tmp_path / "sa.json"
    sa_path.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    drive = drive or FakeDrive()
    client = TestClient(create_app(store, drive=drive, sa_json_path=str(sa_path)))
    return client, store, ws, drive


def _seed_ok_pack(store, ws, n=20, source_id="s1", job_id="j1", skip_indexes=()):
    job = Job(job_id=job_id, count=n, created_utc="Z", state="done")
    src = JobSource(source_id=source_id, filename="a.mp4", requested=n)
    out = Path(ws.source_out_dir(job_id, source_id))
    skip = set(skip_indexes)
    for i in range(1, n + 1):
        filename = f"v{i:02d}.mp4"
        if i not in skip:
            (out / filename).write_bytes(f"vid{i}".encode())
            src.variants.append(VariantInfo(
                source_id=source_id, index=i, filename=filename, status="ok", quality={},
            ))
        else:
            src.variants.append(VariantInfo(
                source_id=source_id, index=i, filename=filename,
                status="best_effort", quality={},
            ))
    job.sources.append(src)
    store._jobs[job_id] = job
    store._source_index[source_id] = (job_id, src)


def _make_dest(client, drive, name):
    folder = drive.make_folder(name)
    return client.post("/api/drive/destinations", json={
        "name": name, "folder_url": folder,
    }).json(), folder


def _wait_export(client, export_id):
    detail = None
    for _ in range(80):
        detail = client.get(f"/api/drive/exports/{export_id}").json()
        if detail["state"] in ("succeeded", "partial", "failed"):
            return detail
        time.sleep(0.05)
    return detail


def _split_jobs(resp):
    body = resp.json()
    if isinstance(body, dict):
        return body.get("jobs") or []
    return body


def _export_id(job: dict) -> str:
    return job.get("id") or job.get("export_id")


def test_split_export_20_by_3_contiguous_slices(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=20)
    main, main_folder = _make_dest(client, drive, "Maya / main")
    trial, trial_folder = _make_dest(client, drive, "Maya / trial")
    growth, growth_folder = _make_dest(client, drive, "Maya / growth")
    variants = [{"source_id": "s1", "index": i} for i in range(1, 21)]
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [main["id"], trial["id"], growth["id"]],
        "variants": variants,
    })
    assert resp.status_code == 201
    jobs = _split_jobs(resp)
    assert len(jobs) == 3
    assert [j.get("dest") or j.get("destination_id") for j in jobs] == [main["id"], trial["id"], growth["id"]]
    details = [_wait_export(client, _export_id(j)) for j in jobs]
    assert [d["state"] for d in details] == ["succeeded", "succeeded", "succeeded"]
    assert [f["index"] for f in details[0]["files"]] == list(range(1, 8))
    assert [f["index"] for f in details[1]["files"]] == list(range(8, 15))
    assert [f["index"] for f in details[2]["files"]] == list(range(15, 21))
    main_names = {f.name for f in drive.list_files(main_folder)}
    trial_names = {f.name for f in drive.list_files(trial_folder)}
    growth_names = {f.name for f in drive.list_files(growth_folder)}
    assert main_names == {f"v{i:02d}.mp4" for i in range(1, 8)}
    assert trial_names == {f"v{i:02d}.mp4" for i in range(8, 15)}
    assert growth_names == {f"v{i:02d}.mp4" for i in range(15, 21)}
    assert main_names.isdisjoint(trial_names)
    assert main_names.isdisjoint(growth_names)
    assert trial_names.isdisjoint(growth_names)


def test_split_export_20_by_2(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=20)
    a, a_folder = _make_dest(client, drive, "main")
    b, b_folder = _make_dest(client, drive, "trial")
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [a["id"], b["id"]],
        "variants": [{"source_id": "s1", "index": i} for i in range(1, 21)],
    })
    assert resp.status_code == 201
    jobs = _split_jobs(resp)
    assert len(jobs) == 2
    details = [_wait_export(client, _export_id(j)) for j in jobs]
    assert [f["index"] for f in details[0]["files"]] == list(range(1, 11))
    assert [f["index"] for f in details[1]["files"]] == list(range(11, 21))
    assert {f.name for f in drive.list_files(a_folder)}.isdisjoint(
        {f.name for f in drive.list_files(b_folder)}
    )


def test_split_export_empty_destinations_is_400(tmp_path):
    client, store, ws, _ = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=4)
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [],
        "variants": [{"source_id": "s1", "index": 1}],
    })
    assert resp.status_code == 400


def test_split_export_unknown_destination_400(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=4)
    dest, _ = _make_dest(client, drive, "main")
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [dest["id"], "dst_missing"],
        "variants": [{"source_id": "s1", "index": i} for i in range(1, 5)],
    })
    assert resp.status_code == 400
    assert "destination" in resp.json()["detail"].lower()


def test_split_export_duplicate_destination_400(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=4)
    dest, _ = _make_dest(client, drive, "main")
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [dest["id"], dest["id"]],
        "variants": [{"source_id": "s1", "index": i} for i in range(1, 5)],
    })
    assert resp.status_code == 400
    assert "duplicate" in resp.json()["detail"].lower()


def test_split_export_zero_ok_files_400(tmp_path):
    client, _, _, drive = _export_app(tmp_path)
    dest, _ = _make_dest(client, drive, "main")
    other, _ = _make_dest(client, drive, "trial")
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [dest["id"], other["id"]],
        "variants": [{"source_id": "missing", "index": 1}],
    })
    assert resp.status_code == 400
    assert "ok" in resp.json()["detail"].lower()


def test_split_export_consumes_caption_bank_once_for_total(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=6)
    main, _ = _make_dest(client, drive, "main")
    trial, _ = _make_dest(client, drive, "trial")
    gym = client.post("/api/caption-banks", json={"name": "Gym"}).json()
    for text in ("one #gym", "two #gym", "three #gym", "four #gym", "five #gym", "six #gym"):
        client.post("/api/captions", json={"text": text, "bank_id": gym["id"]})
    calls: list[int] = []
    orig = client.app.state.captions.advance

    def _wrapped(n, bank_id=None):
        calls.append(n)
        return orig(n, bank_id=bank_id)

    client.app.state.captions.advance = _wrapped
    variants = [
        {"source_id": "s1", "index": i, "caption": f"cap {i}"}
        for i in range(1, 7)
    ]
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [main["id"], trial["id"]],
        "variants": variants,
        "consume_bank": True,
        "caption_bank_id": gym["id"],
    })
    assert resp.status_code == 201
    assert calls == [6]


def test_split_export_drops_non_ok_then_splits_remaining(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=5, skip_indexes=(3,))
    a, _ = _make_dest(client, drive, "main")
    b, _ = _make_dest(client, drive, "trial")
    c, _ = _make_dest(client, drive, "growth")
    resp = client.post("/api/drive/exports/split", json={
        "destination_ids": [a["id"], b["id"], c["id"]],
        "variants": [{"source_id": "s1", "index": i} for i in range(1, 6)],
    })
    assert resp.status_code == 201
    jobs = _split_jobs(resp)
    details = [_wait_export(client, _export_id(j)) for j in jobs]
    assert [len(d["files"]) for d in details] == [2, 1, 1]
    assert [f["index"] for f in details[0]["files"]] == [1, 2]
    assert [f["index"] for f in details[1]["files"]] == [4]
    assert [f["index"] for f in details[2]["files"]] == [5]


def test_split_export_custom_counts_and_one_dest(tmp_path):
    client, store, ws, drive = _export_app(tmp_path)
    _seed_ok_pack(store, ws, n=20)
    main, _ = _make_dest(client, drive, "Maya / main")
    trial, _ = _make_dest(client, drive, "Maya / trial")
    variants = [{"source_id": "s1", "index": i} for i in range(1, 21)]
    bad = client.post("/api/drive/exports/split", json={
        "variants": variants,
        "destinations": [
            {"destination_id": main["id"], "label": "main", "count": 8},
            {"destination_id": trial["id"], "label": "trial", "count": 8},
        ],
    })
    assert bad.status_code == 400
    assert "equal" in bad.json()["detail"].lower()
    resp = client.post("/api/drive/exports/split", json={
        "variants": variants,
        "destinations": [
            {"destination_id": main["id"], "label": "main", "count": 12},
            {"destination_id": trial["id"], "label": "trial", "count": 8},
        ],
    })
    assert resp.status_code == 201
    jobs = _split_jobs(resp)
    details = [_wait_export(client, _export_id(j)) for j in jobs]
    assert [f["index"] for f in details[0]["files"]] == list(range(1, 13))
    assert [f["index"] for f in details[1]["files"]] == list(range(13, 21))
    only_main = client.post("/api/drive/exports/split", json={
        "variants": variants,
        "destinations": [{"destination_id": main["id"], "label": "main", "count": 20}],
    })
    assert only_main.status_code == 201
    assert _split_jobs(only_main)[0]["count"] == 20
