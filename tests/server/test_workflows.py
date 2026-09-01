import json
import os

import pytest
from farm_fakes import FakeDrive
from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.jobs import JobStore
from variant_maker.server.workflow_runner import _export_source
from variant_maker.server.workspace import Workspace


def _app(tmp_path, drive=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    sa = tmp_path / "sa.json"
    sa.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    client = TestClient(create_app(
        store, drive=drive or FakeDrive(), sa_json_path=str(sa),
        enable_workflow_poller=False,
    ))
    return client, store, ws


def _dest(client, drive, name):
    folder = drive.make_folder(name)
    dest = client.post("/api/drive/destinations", json={
        "name": name, "folder_url": folder,
    }).json()
    return dest, folder


def _folders(drive, parent):
    return [f for f in drive.list_files(parent) if f.is_folder]


def test_workflow_crud(tmp_path):
    drive = FakeDrive()
    client, _, _ = _app(tmp_path, drive)
    inbox, _ = _dest(client, drive, "Inbox")
    out, _ = _dest(client, drive, "Out")
    resp = client.post("/api/workflows", json={
        "name": "Reels pack",
        "inbox_destination_id": inbox["id"],
        "output_destination_id": out["id"],
        "count": 5,
        "quality_mode": "fast",
        "enabled": True,
        "poll_seconds": 120,
    })
    assert resp.status_code == 201
    wf = resp.json()
    assert wf["name"] == "Reels pack"
    assert wf["count"] == 5
    assert wf["enabled"] is True
    assert wf["auto_caption"] is False
    assert wf["caption_from_filename"] is False
    listed = client.get("/api/workflows").json()
    assert len(listed) == 1
    patched = client.patch(f"/api/workflows/{wf['id']}", json={"enabled": False}).json()
    assert patched["enabled"] is False
    assert client.delete(f"/api/workflows/{wf['id']}").status_code == 204
    assert client.get("/api/workflows").json() == []


def test_workflow_rejects_unknown_destination(tmp_path):
    drive = FakeDrive()
    client, _, _ = _app(tmp_path, drive)
    inbox, _ = _dest(client, drive, "Inbox")
    resp = client.post("/api/workflows", json={
        "name": "x",
        "inbox_destination_id": inbox["id"],
        "output_destination_id": "dst_missing",
    })
    assert resp.status_code == 400


def test_workflow_rejects_same_inbox_and_output_destination(tmp_path):
    drive = FakeDrive()
    client, _, _ = _app(tmp_path, drive)
    inbox, _ = _dest(client, drive, "Inbox")
    resp = client.post("/api/workflows", json={
        "name": "same",
        "inbox_destination_id": inbox["id"],
        "output_destination_id": inbox["id"],
        "count": 2,
    })
    assert resp.status_code == 400
    assert "different" in resp.json()["detail"].lower()


def test_workflow_rejects_two_destinations_pointing_at_same_drive_folder(tmp_path):
    drive = FakeDrive()
    client, _, _ = _app(tmp_path, drive)
    folder = drive.make_folder("Shared")
    a = client.post("/api/drive/destinations", json={"name": "A", "folder_url": folder}).json()
    b = client.post("/api/drive/destinations", json={"name": "B", "folder_url": folder}).json()
    resp = client.post("/api/workflows", json={
        "name": "alias",
        "inbox_destination_id": a["id"],
        "output_destination_id": b["id"],
        "count": 2,
    })
    assert resp.status_code == 400
    assert "different" in resp.json()["detail"].lower()


def test_workflow_run_exports_new_inbox_video(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"workflow-clip")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Auto",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 2,
        "poll_seconds": 60,
    }).json()

    first = client.post(f"/api/workflows/{wf['id']}/run")
    assert first.status_code == 200
    summary = first.json()["last_summary"]
    assert summary["queued"] + summary["exported"] >= 1
    for jid in summary["job_ids"]:
        store.wait(jid, timeout=5)
    if summary["exported"] < 1:
        second = client.post(f"/api/workflows/{wf['id']}/run")
        summary = second.json()["last_summary"]
    assert summary["exported"] >= 1

    subs = _folders(drive, out)
    assert len(subs) == 1
    assert subs[0].name.startswith("clip__")
    names = {c.name for c in drive.list_files(subs[0].id)}
    assert "manifest.json" in names
    assert any(n.endswith(".mp4") for n in names)

    again = client.post(f"/api/workflows/{wf['id']}/run").json()["last_summary"]
    assert again["skipped"] >= 1
    assert again["queued"] == 0
    assert len(_folders(drive, out)) == 1


def test_workflow_run_unknown_404(tmp_path):
    client, _, _ = _app(tmp_path)
    assert client.post("/api/workflows/wf_nope/run").status_code == 404


def _sweep_until_subfolders(client, store, wf_id, drive, out, n: int, max_runs: int = 8):
    summary = {}
    for _ in range(max_runs):
        summary = client.post(f"/api/workflows/{wf_id}/run").json()["last_summary"]
        for jid in summary.get("job_ids") or []:
            store.wait(jid, timeout=5)
        folders = [c for c in drive.list_files(out) if c.is_folder]
        if len(folders) >= n:
            return summary
    return summary


def test_workflow_exports_each_inbox_video_into_its_own_subfolder(tmp_path):
    """10 clips × 20 variants must be 10 folders, not 200 files in the parent."""
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    for name, payload in (("alpha.mp4", b"alpha-bytes"), ("beta.mp4", b"beta-bytes")):
        clip = tmp_path / name
        clip.write_bytes(payload)
        drive.put_file(name, str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Pack",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 3,
        "poll_seconds": 60,
    }).json()

    summary = _sweep_until_subfolders(client, store, wf["id"], drive, out, 2)
    assert summary.get("failed", 0) == 0

    children = drive.list_files(out)
    folders = [c for c in children if c.is_folder]
    loose_files = [c for c in children if not c.is_folder]
    assert len(folders) == 2, [f.name for f in folders]
    assert loose_files == []
    names = sorted(f.name for f in folders)
    assert names[0].startswith("alpha__")
    assert names[1].startswith("beta__")
    for folder in folders:
        packed = {c.name for c in drive.list_files(folder.id)}
        assert "manifest.json" in packed
        assert {n for n in packed if n.endswith(".mp4")} == {"v01.mp4", "v02.mp4", "v03.mp4"}


def test_workflow_does_not_auto_caption_unless_turned_on(tmp_path):
    """Caption bank must not rename workflow uploads unless auto_caption is on."""
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip-bytes")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    client.post("/api/captions", json={"text": "POV from the bank #reels"})
    wf = client.post("/api/workflows", json={
        "name": "No auto",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
    }).json()
    assert wf["auto_caption"] is False
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 1)
    packed = {c.name for c in drive.list_files(_folders(drive, out)[0].id)}
    assert "v01.mp4" in packed
    assert not any(n.startswith("POV") for n in packed)


def test_workflow_auto_caption_names_drive_files_from_bank(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip-bytes")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    client.post("/api/captions", json={"text": "Wait for it #reels"})
    wf = client.post("/api/workflows", json={
        "name": "Auto cap",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
        "auto_caption": True,
    }).json()
    assert wf["auto_caption"] is True
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 1)
    packed = {c.name for c in drive.list_files(_folders(drive, out)[0].id)}
    assert "Wait for it #reels.mp4" in packed
    assert "v01.mp4" not in packed


def test_workflow_auto_caption_uses_selected_folder_not_generic(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip-bytes")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    client.post("/api/captions", json={"text": "generic hook #reels"})
    gym = client.post("/api/caption-banks", json={"name": "Gym"}).json()
    client.post("/api/captions", json={"text": "gym pump #gymtok", "bank_id": gym["id"]})
    wf = client.post("/api/workflows", json={
        "name": "Gym cap",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
        "auto_caption": True,
        "caption_bank_id": gym["id"],
    }).json()
    assert wf["caption_bank_id"] == gym["id"]
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 1)
    packed = {c.name for c in drive.list_files(_folders(drive, out)[0].id)}
    assert "gym pump #gymtok.mp4" in packed
    assert "generic hook #reels.mp4" not in packed
    folders = {f["name"]: f for f in client.get("/api/caption-banks").json()}
    assert folders["Generic"]["remaining"] == 1
    assert folders["Gym"]["count"] == 1


def test_workflow_filename_captions_seed_from_drive_name(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip-bytes")
    drive.put_file("POV she said wait for it #reels.mp4", str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Filename caps",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 2,
        "poll_seconds": 60,
        "caption_from_filename": True,
    }).json()
    assert wf["caption_from_filename"] is True
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 1)
    packed = {c.name for c in drive.list_files(_folders(drive, out)[0].id)}
    mp4s = {n for n in packed if n.endswith(".mp4")}
    assert len(mp4s) == 2
    assert "v01.mp4" not in mp4s
    joined = " ".join(mp4s).lower()
    assert "wait for it" in joined or "pov" in joined
    assert len(mp4s) == len(set(mp4s))


def test_workflow_filename_mode_wins_over_bank_and_leaves_bank_untouched(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"clip-bytes")
    drive.put_file("POV she said wait for it #reels.mp4", str(clip), parent=inbox)
    client.post("/api/captions", json={"text": "bank hook that must stay #reels"})
    before = client.get("/api/caption-banks").json()
    remaining = next(b["remaining"] for b in before if b.get("is_default"))
    wf = client.post("/api/workflows", json={
        "name": "Filename over bank",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
        "auto_caption": True,
        "caption_from_filename": True,
    }).json()
    assert wf["caption_from_filename"] is True
    assert wf["auto_caption"] is False
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 1)
    packed = {c.name for c in drive.list_files(_folders(drive, out)[0].id)}
    joined = " ".join(packed).lower()
    assert "bank hook" not in joined
    assert "wait for it" in joined or "pov" in joined
    after = client.get("/api/caption-banks").json()
    remaining_after = next(b["remaining"] for b in after if b.get("is_default"))
    assert remaining_after == remaining


def test_workflow_filename_captions_follow_each_clip(tmp_path):
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, out = _dest(client, drive, "Out")
    for name, payload in (
        ("Gym pump night #gymtok.mp4", b"gym-bytes"),
        ("POV she said wait for it #reels.mp4", b"boil-bytes"),
    ):
        clip = tmp_path / name.replace(" ", "_")
        clip.write_bytes(payload)
        drive.put_file(name, str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Mixed inbox",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
        "caption_from_filename": True,
    }).json()
    _sweep_until_subfolders(client, store, wf["id"], drive, out, 2)
    names = []
    for folder in _folders(drive, out):
        names.extend(c.name.lower() for c in drive.list_files(folder.id) if c.name.endswith(".mp4"))
    joined = " ".join(names)
    assert "gym" in joined
    assert "wait for it" in joined or "pov" in joined


def test_workflow_does_not_mark_exported_when_variant_files_are_missing(tmp_path):
    """Don't stamp the ledger done if GPU metadata is ok but Studio has no mp4s."""
    drive = FakeDrive()
    client, store, _ = _app(tmp_path, drive)
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, _ = _dest(client, drive, "Out")
    clip = tmp_path / "ghost.mp4"
    clip.write_bytes(b"ghost-clip")
    drive.put_file("ghost.mp4", str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Ghost",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 1,
        "poll_seconds": 60,
    }).json()
    first = client.post(f"/api/workflows/{wf['id']}/run").json()["last_summary"]
    for jid in first.get("job_ids") or []:
        store.wait(jid, timeout=5)
    job = store.get((first.get("job_ids") or [None])[0])
    assert job is not None
    source = job.sources[0]
    out_dir = store._ws.source_out_dir(job.job_id, source.source_id)
    for v in source.variants:
        path = os.path.join(out_dir, v.filename)
        if os.path.isfile(path):
            os.remove(path)

    with pytest.raises(RuntimeError, match="didn't copy"):
        _export_source(
            drive, store, job, source,
            stem="ghost", sha="abcd1234", output_folder_id=out_dest["folder_id"],
        )


def test_workflow_cancel_stops_running_job_and_turns_watch_off(tmp_path):
    from tests.server.test_jobs import _PausingRunner

    drive = FakeDrive()
    runner = _PausingRunner()
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, runner)
    sa = tmp_path / "sa.json"
    sa.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    client = TestClient(create_app(
        store, drive=drive, sa_json_path=str(sa),
        enable_workflow_poller=False,
    ))
    inbox_dest, inbox = _dest(client, drive, "Inbox")
    out_dest, _out = _dest(client, drive, "Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"cancel-me")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    wf = client.post("/api/workflows", json={
        "name": "Strata",
        "inbox_destination_id": inbox_dest["id"],
        "output_destination_id": out_dest["id"],
        "count": 4,
        "enabled": True,
        "poll_seconds": 240,
    }).json()

    first = client.post(f"/api/workflows/{wf['id']}/run")
    assert first.status_code == 200
    summary = first.json()["last_summary"]
    assert summary["running"] >= 1
    job_ids = summary["job_ids"]
    assert job_ids
    assert runner.v1_done.wait(timeout=5)

    resp = client.post(f"/api/workflows/{wf['id']}/cancel")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert (body.get("last_summary") or {}).get("running") == 0

    for jid in job_ids:
        store.wait(jid, timeout=5)
        job = store.get(jid)
        assert job is not None
        assert job.state == "cancelled"
        assert "Cancelled" in (job.error or "")
    runner.gate.set()


def test_workflow_cancel_unknown_404(tmp_path):
    client, _, _ = _app(tmp_path)
    assert client.post("/api/workflows/wf_nope/cancel").status_code == 404
