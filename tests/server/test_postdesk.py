from __future__ import annotations

import pytest
from farm_fakes import FakeDrive

from variant_maker.server.destinations import DestinationStore
from variant_maker.server.postdesk import export_once, resolve_target_folder, validate_target

TARGET = {"source_file_id": "file123", "model": "GG", "page": "page-a", "winner": "trial-123"}


@pytest.mark.parametrize(
    "field,value",
    [
        ("winner", "../x"),
        ("model", "a/b"),
        ("page", "."),
        ("source_file_id", "https://bad"),
        ("winner", "a\\b"),
    ],
)
def test_target_rejects_paths(field, value):
    with pytest.raises(ValueError):
        validate_target({**TARGET, field: value})


def tree(tmp_path):
    d = FakeDrive()
    root = d.make_folder("POSTDESK")
    page = d.make_folder("page-a", root)
    top = d.make_folder("To Post", page)
    winners = d.make_folder("Winners", top)
    ds = DestinationStore(str(tmp_path / "dest.json"))
    ds.create(name="Postdesk: GG", folder_id=root)
    return d, ds, winners


def test_exact_tenant_root_and_ambiguous_child(tmp_path):
    d, ds, winners = tree(tmp_path)
    assert resolve_target_folder(d, ds, TARGET) == winners
    other = DestinationStore(str(tmp_path / "other.json"))
    with pytest.raises(ValueError):
        resolve_target_folder(d, other, TARGET)
    root = ds.list()[0].folder_id
    d.make_folder("page-a", root)
    with pytest.raises(ValueError):
        resolve_target_folder(d, ds, TARGET)


def test_export_repeat_and_partial_failure_never_duplicates(tmp_path):
    d, _ds, winners = tree(tmp_path)
    a = tmp_path / "a.mp4"
    a.write_bytes(b"video")
    journal = tmp_path / "export.json"
    files = [("stable-1.mp4", str(a)), ("stable-2.mp4", str(a))]
    original = d.upload

    def uncertain(path, parent_id, name=None):
        fid = original(path, parent_id, name)
        if name == "stable-2.mp4":
            raise TimeoutError("response lost after commit")
        return fid

    d.upload = uncertain
    with pytest.raises(TimeoutError):
        export_once(d, str(journal), winners, "trial-123", files)
    d.upload = original
    with pytest.raises(ValueError, match="uncertain"):
        export_once(d, str(journal), winners, "trial-123", files)
    child = d.find_folder("trial-123", winners)
    assert len(d.list_files(child)) == 2


def test_export_success_is_idempotent(tmp_path):
    d, _ds, winners = tree(tmp_path)
    a = tmp_path / "a.mp4"
    a.write_bytes(b"video")
    args = (d, str(tmp_path / "export.json"), winners, "trial-123", [("stable-1.mp4", str(a))])
    first = export_once(*args)
    assert export_once(*args) == first
    assert len(d.list_files(first["folder_id"])) == 1


def test_hq_target_full_flow_requires_click_and_is_tenant_bound(tmp_path):
    import time

    from fastapi.testclient import TestClient

    from tests.server.fakes import FakeRunner
    from tests.server.test_hq_sso import SSO_SECRET, _claims
    from variant_maker.server.app import create_app
    from variant_maker.server.hq_sso import sign_hq_token
    from variant_maker.server.jobs import JobStore, _job_from_dict, _job_to_dict
    from variant_maker.server.tenants import ADMIN_EMAIL_ENV
    from variant_maker.server.workspace import Workspace

    d, _unused, winners = tree(tmp_path)
    root = d.get_file(d.get_file(winners).parents[0]).parents[0]
    model_root = d.get_file(root).parents[0]
    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"fixture")
    fid = d.put_file("source.mp4", str(clip), parent=root)
    env = {
        ADMIN_EMAIL_ENV: "jeff@x.com",
        "VARIANT_AUTH_SECRET": "test-secret",
        "VARIMO_SSO_SECRET": SSO_SECRET,
    }
    sa = tmp_path / "sa.json"
    sa.write_text('{"client_email":"bot@example.com"}')
    app = create_app(
        JobStore(Workspace(str(tmp_path / "app")), FakeRunner({})),
        drive=d,
        sa_json_path=str(sa),
        auth_environ=env,
        oauth_environ=env,
        enable_workflow_poller=False,
    )
    c = TestClient(app)
    assert (
        c.post(
            "/api/auth/password", json={"email": "jeff@x.com", "password": "correct-horse"}
        ).status_code
        == 200
    )
    ws = c.get("/api/auth/me").json()["workspace_id"]
    bundle = app.state.tenant_hub.bundle(ws)
    bundle.destinations.create(name="Postdesk: GG", folder_id=model_root)
    target = {**TARGET, "source_file_id": fid}
    token = sign_hq_token(_claims("jeff@x.com", target=target), SSO_SECRET)
    r = c.post("/api/auth/hq", json={"token": token})
    assert r.status_code == 200, r.text
    hid = r.json()["next"].split("handoff=")[1]
    assert bundle.store.list() == []
    preview = c.get("/api/hq/targets/" + hid)
    assert preview.status_code == 200, preview.text
    assert preview.json()["folder_id"] == winners
    url = "/api/hq/targets/" + hid + "/generate?count=1"
    r = c.post(url)
    assert r.status_code == 200, r.text
    jid = r.json()["job_id"]
    assert bundle.store.wait(jid, timeout=5)
    for _ in range(50):
        receipt = c.post("/api/hq/targets/" + hid + "/export")
        if receipt.status_code == 200:
            break
        time.sleep(0.01)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["exported"] == 1
    assert c.post(url).json()["job_id"] == jid
    assert len(bundle.store.list()) == 1
    assert len(d.list_files(receipt.json()["folder_id"])) == 1
    job = bundle.store.get(jid)
    restored = _job_from_dict(_job_to_dict(job))
    assert restored.postdesk_target == job.postdesk_target
    assert (
        c.post(
            "/api/auth/invites", json={"email": "other@x.com", "kind": "new_workspace"}
        ).status_code
        == 201
    )
    other = TestClient(app)
    assert (
        other.post(
            "/api/auth/password", json={"email": "other@x.com", "password": "other-pass"}
        ).status_code
        == 200
    )
    assert other.get("/api/hq/targets/" + hid).status_code == 404
    assert other.post(url).status_code == 404
    changed = {**target, "source_file_id": "different"}
    assert (
        c.post(
            "/api/auth/hq",
            json={"token": sign_hq_token(_claims("jeff@x.com", target=changed), SSO_SECRET)},
        ).status_code
        == 409
    )


def test_winner_workflow_metadata_roundtrip(tmp_path):
    from variant_maker.server.workflows import WorkflowStore

    s = WorkflowStore(str(tmp_path / "wf.json"))
    w = s.create(
        name="w", inbox_destination_id="in", output_destination_id="out", winner="trial-123"
    )
    assert WorkflowStore(str(tmp_path / "wf.json")).get(w.id).winner == "trial-123"
    s.update(w.id, name="renamed")
    assert s.get(w.id).winner == "trial-123"
    with pytest.raises(ValueError):
        s.update(w.id, winner="../bad")
    s.update(w.id, winner="")
    assert s.get(w.id).winner == ""


def test_concurrent_export_invocations_upload_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    d, _ds, winners = tree(tmp_path)
    a = tmp_path / "a.mp4"
    a.write_bytes(b"video")
    args = (d, str(tmp_path / "export.json"), winners, "trial-123", [("stable.mp4", str(a))])
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(lambda _: export_once(*args), range(2)))
    assert rows[0] == rows[1]
    assert len(d.list_files(rows[0]["folder_id"])) == 1


def test_winner_claim_prevents_second_source(tmp_path):
    from variant_maker.server.postdesk import claim_winner

    claim_winner(str(tmp_path), "folder", "trial", "source-a")
    claim_winner(str(tmp_path), "folder", "trial", "source-a")
    with pytest.raises(ValueError):
        claim_winner(str(tmp_path), "folder", "trial", "source-b")


def test_workflow_exports_winner_once_and_preserves_destination(tmp_path):
    from tests.server.fakes import FakeRunner
    from variant_maker.farm.ledger import Ledger
    from variant_maker.server.jobs import JobStore, _job_from_dict, _job_to_dict
    from variant_maker.server.workflow_runner import tick_workflow
    from variant_maker.server.workflows import Workflow
    from variant_maker.server.workspace import Workspace

    d = FakeDrive()
    inbox = d.make_folder("Inbox")
    out = d.make_folder("Winners")
    new = d.make_folder("Other")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video")
    d.put_file("clip.mp4", str(clip), parent=inbox)
    store = JobStore(Workspace(str(tmp_path / "ws")), FakeRunner({}))
    ledger = Ledger(str(tmp_path / "ledger.json"))
    w = Workflow(
        id="wf",
        name="winner",
        inbox_destination_id="in",
        output_destination_id="out",
        count=1,
        winner="trial-1",
    )
    args = {
        "drive": d,
        "inbox_folder_id": inbox,
        "output_folder_id": out,
        "job_store": store,
        "ledger": ledger,
        "work_dir": str(tmp_path / "work"),
    }
    first = tick_workflow(w, **args)
    for jid in first.job_ids:
        assert store.wait(jid, timeout=5)
    job = store.list()[0]
    assert _job_from_dict(_job_to_dict(job)).workflow_output_folder_id == out
    args["output_folder_id"] = new
    w.winner = "changed"
    tick_workflow(w, **args)
    tick_workflow(w, **args)
    folder = d.find_folder("trial-1", out)
    assert folder
    assert len(d.list_files(folder)) == 1
    assert d.list_files(new) == []
    assert len(store.list()) == 1


def test_same_source_cannot_be_posted_by_two_workflows(tmp_path):
    from variant_maker.server.postdesk import claim_winner

    claim_winner(str(tmp_path), "folder", "trial", "source", owner="workflow:a")
    with pytest.raises(ValueError):
        claim_winner(str(tmp_path), "folder", "trial", "source", owner="workflow:b")
