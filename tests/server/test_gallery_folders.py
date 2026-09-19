"""Gallery folders: workspace-local labels for packs, not Drive destinations."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.gallery_folders import GalleryFolderError, GalleryFolderStore
from variant_maker.server.jobs import JobStore
from variant_maker.server.tenants import ADMIN_EMAIL_ENV
from variant_maker.server.workspace import Workspace


def test_store_create_assign_rename_delete(tmp_path):
    store = GalleryFolderStore(str(tmp_path / "folders.json"))
    folder = store.create("Client A")
    assert folder.id.startswith("gf_")
    assert folder.name == "Client A"
    store.assign("src_1", folder.id)
    assert store.assignment("src_1") == folder.id
    renamed = store.rename(folder.id, "Trial Reels")
    assert renamed is not None
    assert renamed.name == "Trial Reels"
    assert store.assignment("src_1") == folder.id
    assert store.delete(folder.id) is True
    assert store.list() == []
    assert store.assignment("src_1") is None


def test_store_rejects_blank_and_duplicate_names(tmp_path):
    store = GalleryFolderStore(str(tmp_path / "folders.json"))
    store.create("Client A")
    try:
        store.create("   ")
        raise AssertionError("blank name")
    except GalleryFolderError as exc:
        assert "required" in str(exc).lower()
    try:
        store.create("client a")
        raise AssertionError("duplicate")
    except GalleryFolderError as exc:
        assert "already" in str(exc).lower()


def test_store_overview_counts_and_prunes_gone_packs(tmp_path):
    store = GalleryFolderStore(str(tmp_path / "folders.json"))
    folder = store.create("Client A")
    store.assign("keep", folder.id)
    store.assign("gone", folder.id)
    rows, unassigned = store.overview({"keep", "loose"})
    assert unassigned == 1
    assert rows[0][1] == 1
    assert store.assignment("gone") is None


def _app(tmp_path, *, auth=False):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    env = {
        ADMIN_EMAIL_ENV: "jeff@x.com",
        "VARIANT_AUTH_SECRET": "test-auth-secret",
    } if auth else {}
    app = create_app(
        store,
        auth_environ=env,
        oauth_environ=env,
        enable_workflow_poller=False,
    )
    return TestClient(app), store


def _pack(client, store, name="clip.mp4"):
    resp = client.post(
        "/api/jobs",
        files=[("files", (name, b"x", "video/mp4"))],
        data={"count": "1"},
    )
    assert resp.status_code == 201, resp.text
    job_id = resp.json()["job_id"]
    assert store.wait(job_id, timeout=5)
    gallery = client.get("/api/gallery").json()
    return next(s for s in gallery if s["filename"] == name)


def test_gallery_has_null_folder_until_assigned(tmp_path):
    client, store = _app(tmp_path)
    pack = _pack(client, store)
    assert pack.get("gallery_folder_id") in (None, "")
    listed = client.get("/api/gallery/folders").json()
    assert listed["folders"] == []
    assert listed["unassigned_count"] == 1


def test_create_folder_and_move_pack(tmp_path):
    client, store = _app(tmp_path)
    pack = _pack(client, store, "boil.mp4")
    created = client.post("/api/gallery/folders", json={"name": "Client A"})
    assert created.status_code == 201, created.text
    folder = created.json()
    assert folder["name"] == "Client A"
    assert folder["pack_count"] == 0
    moved = client.put(
        f"/api/sources/{pack['source_id']}/gallery-folder",
        json={"folder_id": folder["id"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["gallery_folder_id"] == folder["id"]
    gallery = client.get("/api/gallery").json()
    assert gallery[0]["gallery_folder_id"] == folder["id"]
    listed = client.get("/api/gallery/folders").json()
    assert listed["folders"][0]["pack_count"] == 1
    assert listed["unassigned_count"] == 0


def test_unknown_folder_assign_is_404(tmp_path):
    client, store = _app(tmp_path)
    pack = _pack(client, store)
    resp = client.put(
        f"/api/sources/{pack['source_id']}/gallery-folder",
        json={"folder_id": "gf_missing"},
    )
    assert resp.status_code == 404


def test_delete_folder_unfiles_packs(tmp_path):
    client, store = _app(tmp_path)
    pack = _pack(client, store)
    folder = client.post("/api/gallery/folders", json={"name": "Temp"}).json()
    client.put(
        f"/api/sources/{pack['source_id']}/gallery-folder",
        json={"folder_id": folder["id"]},
    )
    assert client.delete(f"/api/gallery/folders/{folder['id']}").status_code == 204
    gallery = client.get("/api/gallery").json()
    assert gallery[0].get("gallery_folder_id") in (None, "")


def test_delete_pack_drops_assignment(tmp_path):
    client, store = _app(tmp_path)
    pack = _pack(client, store)
    folder = client.post("/api/gallery/folders", json={"name": "Keep"}).json()
    client.put(
        f"/api/sources/{pack['source_id']}/gallery-folder",
        json={"folder_id": folder["id"]},
    )
    assert client.delete(f"/api/sources/{pack['source_id']}").status_code == 204
    listed = client.get("/api/gallery/folders").json()
    assert listed["folders"][0]["pack_count"] == 0
    assert listed["unassigned_count"] == 0


def test_logged_in_studios_cannot_see_each_others_folders(tmp_path):
    client, _store = _app(tmp_path, auth=True)
    jeff = TestClient(client.app)
    ops = TestClient(client.app)
    assert jeff.post(
        "/api/auth/password", json={"email": "jeff@x.com", "password": "secret12"},
    ).status_code == 200
    inv = jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    assert inv.status_code == 201
    assert ops.post(
        "/api/auth/password", json={"email": "ops@x.com", "password": "ops-secret"},
    ).status_code == 200

    mine = jeff.post("/api/gallery/folders", json={"name": "Jeff Tingz"})
    assert mine.status_code == 201
    theirs = ops.get("/api/gallery/folders").json()
    assert theirs["folders"] == []
    stolen = ops.put(
        "/api/sources/nope/gallery-folder",
        json={"folder_id": mine.json()["id"]},
    )
    assert stolen.status_code == 404
