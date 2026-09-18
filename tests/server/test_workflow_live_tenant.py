"""Live Workflows path: auth on, TenantHub, site studio@ Drive client."""
from __future__ import annotations

import json
import time

from farm_fakes import FakeDrive
from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.jobs import JobStore
from variant_maker.server.tenants import ADMIN_EMAIL_ENV
from variant_maker.server.workflow_runner import public_workflow_error
from variant_maker.server.workspace import Workspace


def test_public_workflow_error_tells_va_to_share_with_studio():
    msg = public_workflow_error(RuntimeError("404 File not found"))
    assert "studio@varimo.io" in msg
    assert "share" in msg.lower()
    assert "404" not in msg
    assert public_workflow_error(RuntimeError("disk full")) == "disk full"
    named = public_workflow_error(RuntimeError("403 forbidden"), share_email="studio@varimo.io")
    assert "studio@varimo.io" in named


def _sa(tmp_path):
    path = tmp_path / "sa.json"
    path.write_text(json.dumps({"client_email": "bot@x.iam.gserviceaccount.com"}))
    return str(path)


def _folders(drive, parent):
    return [f for f in drive.list_files(parent) if f.is_folder]


def test_logged_in_customer_workflow_exports_to_their_output(tmp_path):
    """The first Agency customer is on TenantHub, not the no-auth test store."""
    drive = FakeDrive()
    inbox = drive.make_folder("Inbox")
    out = drive.make_folder("Out")
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"workflow-clip")
    drive.put_file("clip.mp4", str(clip), parent=inbox)
    env = {
        ADMIN_EMAIL_ENV: "jeff@x.com",
        "VARIANT_AUTH_SECRET": "test-auth-secret",
    }
    app = create_app(
        JobStore(Workspace(str(tmp_path)), FakeRunner({})),
        drive=drive,
        sa_json_path=_sa(tmp_path),
        auth_environ=env,
        oauth_environ=env,
        enable_workflow_poller=False,
    )
    jeff = TestClient(app)
    ops = TestClient(app)
    assert jeff.post(
        "/api/auth/password", json={"email": "jeff@x.com", "password": "secret12"},
    ).status_code == 200
    inv = jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    assert inv.status_code == 201
    assert ops.post(
        "/api/auth/password", json={"email": "ops@x.com", "password": "ops-secret"},
    ).status_code == 200

    hub = app.state.tenant_hub
    ops_ws = ops.get("/api/auth/me").json()["workspace_id"]
    bundle = hub.bundle(ops_ws)
    inbox_dest = bundle.destinations.create(name="Inbox", folder_id=inbox, auth_mode="oauth")
    out_dest = bundle.destinations.create(name="Out", folder_id=out, auth_mode="oauth")

    wf = ops.post("/api/workflows", json={
        "name": "Customer flow",
        "inbox_destination_id": inbox_dest.id,
        "output_destination_id": out_dest.id,
        "count": 1,
        "poll_seconds": 60,
    })
    assert wf.status_code == 201, wf.text
    run = ops.post(f"/api/workflows/{wf.json()['id']}/run")
    assert run.status_code == 200, run.text
    summary = run.json()["last_summary"]
    for jid in summary.get("job_ids") or []:
        assert bundle.store.wait(jid, timeout=5)
    if (summary.get("exported") or 0) < 1:
        summary = ops.post(f"/api/workflows/{wf.json()['id']}/run").json()["last_summary"]
    assert summary["exported"] >= 1, summary
    assert summary.get("error") in (None, "")
    subs = _folders(drive, out)
    assert len(subs) == 1
    assert any(n.name.endswith(".mp4") for n in drive.list_files(subs[0].id))


def test_workflow_run_records_drive_error_instead_of_500(tmp_path):
    class BoomDrive(FakeDrive):
        def list_files(self, folder_id: str):
            raise RuntimeError("404 File not found")

    drive = BoomDrive()
    inbox = drive.make_folder("Inbox")
    out = drive.make_folder("Out")
    client = TestClient(create_app(
        JobStore(Workspace(str(tmp_path)), FakeRunner({})),
        drive=drive,
        sa_json_path=_sa(tmp_path),
        enable_workflow_poller=False,
    ))
    inbox_dest = client.app.state.destinations.create(
        name="Inbox", folder_id=inbox, auth_mode="oauth",
    )
    out_dest = client.app.state.destinations.create(
        name="Out", folder_id=out, auth_mode="oauth",
    )
    wf = client.post("/api/workflows", json={
        "name": "Broken inbox",
        "inbox_destination_id": inbox_dest.id,
        "output_destination_id": out_dest.id,
        "count": 1,
        "poll_seconds": 60,
    }).json()
    run = client.post(f"/api/workflows/{wf['id']}/run")
    assert run.status_code == 200, run.text
    err = (run.json().get("last_summary") or {}).get("error") or ""
    assert "studio@" in err.lower() or "share" in err.lower() or "inbox" in err.lower()
    assert "404" in err or "not found" in err.lower() or "can't open" in err.lower() or "cannot" in err.lower()


def test_workflow_empty_inbox_says_so(tmp_path):
    drive = FakeDrive()
    inbox = drive.make_folder("Inbox")
    out = drive.make_folder("Out")
    client = TestClient(create_app(
        JobStore(Workspace(str(tmp_path)), FakeRunner({})),
        drive=drive,
        sa_json_path=_sa(tmp_path),
        enable_workflow_poller=False,
    ))
    inbox_dest = client.app.state.destinations.create(
        name="Inbox", folder_id=inbox, auth_mode="oauth",
    )
    out_dest = client.app.state.destinations.create(
        name="Out", folder_id=out, auth_mode="oauth",
    )
    wf = client.post("/api/workflows", json={
        "name": "Empty inbox",
        "inbox_destination_id": inbox_dest.id,
        "output_destination_id": out_dest.id,
        "count": 1,
        "poll_seconds": 60,
    }).json()
    run = client.post(f"/api/workflows/{wf['id']}/run")
    assert run.status_code == 200
    err = (run.json().get("last_summary") or {}).get("error") or ""
    assert "video" in err.lower() or "inbox" in err.lower()
    time.sleep(0.05)
    assert _folders(drive, out) == []
