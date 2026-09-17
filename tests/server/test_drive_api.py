import json
from pathlib import Path

from fastapi.testclient import TestClient

from farm_fakes import FakeDrive
from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.jobs import Job, JobSource, JobStore, VariantInfo
from variant_maker.server.workspace import Workspace


def _app(tmp_path, drive=None, sa_path=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    if sa_path is None:
        sa_path = tmp_path / "sa.json"
        sa_path.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    return TestClient(create_app(store, drive=drive or FakeDrive(), sa_json_path=str(sa_path))), store, ws


def test_status_ready(tmp_path):
    client, _, _ = _app(tmp_path)
    body = client.get("/api/drive/status").json()
    assert body["status"] == "ready"
    assert body["sa_email"] == "bot@x.iam.gserviceaccount.com"
    assert body["share_email"] == "studio@varimo.io"


def test_status_not_configured(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    client = TestClient(create_app(store, drive=None, sa_json_path=""))
    body = client.get("/api/drive/status").json()
    assert body["status"] == "not_configured"


def test_create_destination_probes(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("shared")
    client, _, _ = _app(tmp_path, drive=drive)
    resp = client.post("/api/drive/destinations", json={
        "name": "Reels",
        "folder_url": f"https://drive.google.com/drive/folders/{folder}",
    })
    assert resp.status_code == 201
    assert resp.json()["folder_id"] == folder
    assert resp.json()["auth_mode"] == "service_account"


def test_create_destination_rejects_bad_url(tmp_path):
    client, _, _ = _app(tmp_path)
    resp = client.post("/api/drive/destinations", json={"name": "x", "folder_url": "nope"})
    assert resp.status_code == 400


def test_export_ok_variant(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, store, ws = _app(tmp_path, drive=drive)
    # seed destination
    dest = client.post("/api/drive/destinations", json={
        "name": "Out", "folder_url": folder,
    }).json()
    # seed ok variant
    job = Job(job_id="j1", count=1, created_utc="Z", state="done")
    src = JobSource(source_id="s1", filename="a.mp4", requested=1)
    out = ws.source_out_dir("j1", "s1")
    Path(out, "v01.mp4").write_bytes(b"vid")
    src.variants.append(VariantInfo(
        source_id="s1", index=1, filename="v01.mp4", status="ok", quality={},
    ))
    job.sources.append(src)
    store._jobs["j1"] = job
    store._source_index["s1"] = ("j1", src)
    resp = client.post("/api/drive/exports", json={
        "destination_id": dest["id"],
        "variants": [{"source_id": "s1", "index": 1}],
    })
    assert resp.status_code == 201
    export_id = resp.json()["export_id"]
    import time
    for _ in range(50):
        detail = client.get(f"/api/drive/exports/{export_id}").json()
        if detail["state"] in ("succeeded", "partial", "failed"):
            break
        time.sleep(0.05)
    assert detail["state"] == "succeeded"
    assert any(f.name == "v01.mp4" for f in drive.list_files(folder))


def test_caption_bank_crud_and_preview(tmp_path):
    client, _, _ = _app(tmp_path)
    created = client.post("/api/captions", json={"text": "First #reels"}).json()
    assert created["text"] == "First #reels"
    client.post("/api/captions", json={"text": "Second #fyp"})
    listed = client.get("/api/captions").json()
    assert listed["cursor"] == 0
    assert listed["count"] == 2
    assert listed["remaining"] == 2
    assert listed["bank_name"] == "Generic"
    assert [c["text"] for c in listed["items"]] == ["First #reels", "Second #fyp"]
    preview = client.get("/api/captions/preview", params={"n": 3}).json()
    assert preview["captions"] == ["First #reels", "Second #fyp", "First #reels"]
    assert client.get("/api/captions").json()["cursor"] == 0
    advanced = client.post("/api/captions/advance", json={"n": 1}).json()
    assert advanced["cursor"] == 1
    assert advanced["remaining"] == 1
    assert client.delete(f"/api/captions/{created['id']}").status_code == 204
    assert [c["text"] for c in client.get("/api/captions").json()["items"]] == ["Second #fyp"]


def test_caption_folders_are_isolated(tmp_path):
    client, _, _ = _app(tmp_path)
    gym = client.post("/api/caption-banks", json={"name": "Gym"}).json()
    assert gym["name"] == "Gym"
    assert gym["count"] == 0
    client.post("/api/captions", json={"text": "gym pump #gymtok", "bank_id": gym["id"]})
    client.post("/api/captions", json={"text": "gym night #gymtok", "bank_id": gym["id"]})
    client.post("/api/captions", json={"text": "gym morning #gymtok", "bank_id": gym["id"]})
    client.post("/api/captions", json={"text": "generic hook"})
    gym_bank = client.get("/api/captions", params={"bank_id": gym["id"]}).json()
    generic = client.get("/api/captions").json()
    assert [c["text"] for c in gym_bank["items"]] == [
        "gym pump #gymtok", "gym night #gymtok", "gym morning #gymtok",
    ]
    assert [c["text"] for c in generic["items"]] == ["generic hook"]
    folders = {f["name"]: f for f in client.get("/api/caption-banks").json()}
    assert folders["Gym"]["count"] == 3
    assert folders["Gym"]["remaining"] == 3
    assert folders["Generic"]["count"] == 1
    assert folders["Generic"]["remaining"] == 1
    client.post("/api/captions/advance", json={"n": 2, "bank_id": gym["id"]})
    folders = {f["name"]: f for f in client.get("/api/caption-banks").json()}
    assert folders["Gym"]["remaining"] == 1
    assert folders["Gym"]["low"] is True
    assert folders["Generic"]["remaining"] == 1


def test_export_uses_per_variant_caption(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, store, ws = _app(tmp_path, drive=drive)
    dest = client.post("/api/drive/destinations", json={
        "name": "Out", "folder_url": folder,
    }).json()
    job = Job(job_id="j1", count=1, created_utc="Z", state="done")
    src = JobSource(source_id="s1", filename="a.mp4", requested=1)
    Path(ws.source_out_dir("j1", "s1"), "v01.mp4").write_bytes(b"vid")
    src.variants.append(VariantInfo(
        source_id="s1", index=1, filename="v01.mp4", status="ok", quality={},
    ))
    job.sources.append(src)
    store._jobs["j1"] = job
    store._source_index["s1"] = ("j1", src)
    resp = client.post("/api/drive/exports", json={
        "destination_id": dest["id"],
        "consume_bank": True,
        "variants": [{"source_id": "s1", "index": 1, "caption": "Gallery edit #reels"}],
    })
    assert resp.status_code == 201
    export_id = resp.json()["export_id"]
    import time
    for _ in range(50):
        detail = client.get(f"/api/drive/exports/{export_id}").json()
        if detail["state"] in ("succeeded", "partial", "failed"):
            break
        time.sleep(0.05)
    assert detail["state"] == "succeeded"
    assert any(f.name == "Gallery edit #reels.mp4" for f in drive.list_files(folder))
    assert detail["files"][0]["filename"] == "Gallery edit #reels.mp4"


def test_export_rejects_when_no_ok(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("out")
    client, _, _ = _app(tmp_path, drive=drive)
    dest = client.post("/api/drive/destinations", json={
        "name": "Out", "folder_url": folder,
    }).json()
    resp = client.post("/api/drive/exports", json={
        "destination_id": dest["id"],
        "variants": [{"source_id": "missing", "index": 1}],
    })
    assert resp.status_code == 400
    assert "ok" in resp.json()["detail"].lower()


def test_mutating_disabled_when_not_configured(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    client = TestClient(create_app(store, drive=None, sa_json_path=""))
    resp = client.post("/api/drive/destinations", json={"name": "x", "folder_url": "1AbCdefghijk0123456789"})
    assert resp.status_code == 503
