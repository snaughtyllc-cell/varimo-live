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


@pytest.mark.parametrize("initial_route", ["manual", "api", "api_lost", "concurrent"])
def test_hq_target_full_flow_requires_click_and_is_tenant_bound(tmp_path, initial_route, monkeypatch):
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
    import hashlib
    import json

    api_key = "test-only-hq-api-key-not-production-12345"
    grant = {
        "sha256": hashlib.sha256(api_key.encode()).hexdigest(),
        "scope": "varimo:jobs",
        "workspace_id": ws,
        "email": "jeff@x.com",
        "models": ["GG"],
        "expires_at": time.time() + 3600,
    }
    env["VARIMO_HQ_API_KEYS_JSON"] = json.dumps([grant])
    api = TestClient(app)
    headers = {"Authorization": "Bearer " + api_key}
    body = {"target": target, "count": 1}
    assert api.post("/api/hq/jobs", json=body).status_code == 401
    assert (
        api.post(
            "/api/hq/jobs", json={**body, "target": {**target, "model": "Other"}}, headers=headers
        ).status_code
        == 403
    )
    assert api.get("/api/jobs", headers=headers).status_code == 401
    if initial_route == "api_lost":
        from variant_maker.server import postdesk

        real_save = postdesk.save

        def lose_response(path, data):
            if "job_id" in data and "target" in data:
                raise OSError("simulated crash before operation receipt")
            real_save(path, data)

        monkeypatch.setattr(postdesk, "save", lose_response)
        uncertain = TestClient(app, raise_server_exceptions=False)
        assert uncertain.post("/api/hq/jobs", json=body, headers=headers).status_code == 500
        monkeypatch.setattr(postdesk, "save", real_save)
        pending_job = bundle.store.list()[0]
        assert bundle.store.wait(pending_job.job_id, timeout=5)
        assert api.post("/api/hq/jobs/" + hid + "/reconcile", headers=headers).status_code == 200
        r = c.post(url)  # A fallback recovers B's already-persisted job.
    elif initial_route == "concurrent":
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(api.post, "/api/hq/jobs", json=body, headers=headers)
            second = pool.submit(c.post, url)
            r = first.result()
            assert second.result().json()["job_id"] == r.json()["job_id"]
    else:
        r = (
            api.post("/api/hq/jobs", json=body, headers=headers)
            if initial_route == "api"
            else c.post(url)
        )
    assert r.status_code == 200, r.text
    jid = r.json()["job_id"]
    assert api.post("/api/hq/jobs", json=body, headers=headers).json()["job_id"] == jid
    assert api.post("/api/hq/jobs", json={**body, "count": 2}, headers=headers).status_code == 409
    assert api.get("/api/hq/jobs/" + hid, headers=headers).status_code == 200
    lookup = api.get("/api/hq/jobs/lookup", params=target, headers=headers)
    assert lookup.status_code == 200 and lookup.json()["job_id"] == jid
    assert (
        api.post(
            "/api/hq/jobs",
            json={**body, "target": {**target, "source_file_id": "conflict"}},
            headers=headers,
        ).status_code
        == 409
    )
    assert bundle.store.wait(jid, timeout=5)
    auto_folder = d.find_folder(target["winner"], winners)
    assert auto_folder and len(d.list_files(auto_folder)) == 1
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


def test_external_registered_source_root_and_unregistered_denial(tmp_path):
    from variant_maker.server.postdesk import authorized_source

    d, ds, _ = tree(tmp_path)
    external = d.make_folder("Existing trial videos")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video")
    fid = d.put_file("clip.mp4", str(clip), parent=external)
    target = {**TARGET, "source_file_id": fid}
    with pytest.raises(ValueError):
        authorized_source(d, ds, target)
    ds.create(name="Postdesk source: GG", folder_id=external)
    assert authorized_source(d, ds, target).id == fid
    with pytest.raises(ValueError):
        authorized_source(d, ds, {**target, "model": "Other"})


def test_workflow_submission_recovers_after_lost_ledger_write(tmp_path, monkeypatch):
    from tests.server.fakes import FakeRunner
    from variant_maker.farm.ledger import Ledger
    from variant_maker.server.drive_exports import ExportStore, bind_studio_export
    from variant_maker.server.jobs import JobStore
    from variant_maker.server.workflow_runner import tick_workflow
    from variant_maker.server.workflows import Workflow
    from variant_maker.server.workspace import Workspace

    d = FakeDrive()
    inbox = d.make_folder("Inbox")
    out = d.make_folder("Winners")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video")
    d.put_file("clip.mp4", str(clip), parent=inbox)
    store = JobStore(Workspace(str(tmp_path / "ws")), FakeRunner({}))
    bind_studio_export(
        store,
        DestinationStore(str(tmp_path / "dest.json")),
        ExportStore(str(tmp_path / "exports.json")),
        d,
    )
    ledger = Ledger(str(tmp_path / "ledger.json"))
    w = Workflow(
        id="wf",
        name="winner",
        inbox_destination_id="in",
        output_destination_id="out",
        count=1,
        winner="trial",
    )
    args = {
        "drive": d,
        "inbox_folder_id": inbox,
        "output_folder_id": out,
        "job_store": store,
        "ledger": ledger,
        "work_dir": str(tmp_path / "work"),
    }
    original = ledger.mark_running

    def interrupted(*args, **kwargs):
        raise KeyboardInterrupt("crash before ledger write")

    monkeypatch.setattr(ledger, "mark_running", interrupted)
    with pytest.raises(KeyboardInterrupt):
        tick_workflow(w, **args)
    job = store.list()[0]
    assert store.wait(job.job_id, timeout=5)
    monkeypatch.setattr(ledger, "mark_running", original)
    restarted = JobStore(Workspace(str(tmp_path / "ws")), FakeRunner({}))
    restarted.hydrate_from_disk()
    args["job_store"] = restarted
    tick_workflow(w, **args)
    assert len(store.list()) == 1
    assert len(d.list_files(d.find_folder("trial", out))) == 1


def test_hq_api_credentials_fail_closed():
    import hashlib
    import json

    from variant_maker.server.hq_api import authenticate

    key = "test-only-key-with-at-least-32-characters"
    grant = {
        "sha256": hashlib.sha256(key.encode()).hexdigest(),
        "scope": "varimo:jobs",
        "workspace_id": "tenant",
        "email": "test@example.com",
        "models": ["GG"],
        "expires_at": 100,
    }
    header = "Bearer " + key
    assert authenticate(header, json.dumps([grant]), 99)
    for config in (
        [{**grant, "expires_at": 99}],
        [{**grant, "scope": "admin"}],
        [{**grant, "models": ["*"]}],
        [grant, grant],
        {},
        [{**grant, "expires_at": True}],
    ):
        assert authenticate(header, json.dumps(config), 99) is None
    assert authenticate("Bearer wrong", json.dumps([grant]), 99) is None


def test_workflow_intent_recovers_job_after_response_loss_and_restart(tmp_path):
    from tests.server.fakes import FakeRunner
    from variant_maker.server.jobs import JobStore
    from variant_maker.server.postdesk import workflow_submission
    from variant_maker.server.workspace import Workspace

    root = str(tmp_path / "ws")
    store = JobStore(Workspace(root), FakeRunner({}))
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"video")
    payload = {"folder_id": "folder", "winner": "trial"}

    def interrupted(key):
        job = store.create_job_from_paths(
            [("clip.mp4", str(clip))],
            count=1,
            postdesk_target={**payload, "workflow_operation": key},
        )
        assert store.wait(job.job_id, timeout=5)
        raise KeyboardInterrupt("lost job creation response")

    with pytest.raises(KeyboardInterrupt):
        workflow_submission(store, "wf", "source", payload, interrupted)
    restarted = JobStore(Workspace(root), FakeRunner({}))
    restarted.hydrate_from_disk()

    def forbidden(_key):
        raise AssertionError("duplicate job")

    recovered = workflow_submission(restarted, "wf", "source", payload, forbidden)
    assert recovered.job_id == store.list()[0].job_id
    with pytest.raises(ValueError, match="conflicts"):
        workflow_submission(restarted, "wf", "source", {**payload, "winner": "other"}, forbidden)


def test_submission_intent_without_recoverable_job_never_repeats(tmp_path):
    from types import SimpleNamespace

    from variant_maker.server.postdesk import workflow_submission

    store = SimpleNamespace(_ws=SimpleNamespace(root=str(tmp_path)), list=list)
    calls = []

    def interrupted(_key):
        calls.append(1)
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        workflow_submission(store, "wf", "source", {}, interrupted)
    with pytest.raises(ValueError, match="needs review"):
        workflow_submission(store, "wf", "source", {}, interrupted)
    assert len(calls) == 1
