"""HQ API `"motion": "off"` opt-out: validation, idempotency, plumbing to the runner."""
from __future__ import annotations

import hashlib
import json
import time

import pytest
from farm_fakes import FakeDrive
from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.destinations import DestinationStore  # noqa: F401
from variant_maker.server.jobs import JobStore, _job_from_dict, _job_to_dict
from variant_maker.server.tenants import ADMIN_EMAIL_ENV
from variant_maker.server.workspace import Workspace

API_KEY = "test-only-hq-api-key-not-production-12345"


@pytest.fixture
def hq(tmp_path):
    d = FakeDrive()
    root = d.make_folder("POSTDESK")
    page = d.make_folder("page-a", root)
    top = d.make_folder("To Post", page)
    d.make_folder("Winners", top)
    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"fixture")
    fid = d.put_file("source.mp4", str(clip), parent=root)
    env = {ADMIN_EMAIL_ENV: "jeff@x.com", "VARIANT_AUTH_SECRET": "test-secret"}
    sa = tmp_path / "sa.json"
    sa.write_text('{"client_email":"bot@example.com"}')
    runner = FakeRunner({})
    app = create_app(
        JobStore(Workspace(str(tmp_path / "app")), runner),
        drive=d, sa_json_path=str(sa), auth_environ=env, oauth_environ=env,
        enable_workflow_poller=False,
    )
    c = TestClient(app)
    assert c.post("/api/auth/password",
                  json={"email": "jeff@x.com", "password": "correct-horse"}).status_code == 200
    ws = c.get("/api/auth/me").json()["workspace_id"]
    bundle = app.state.tenant_hub.bundle(ws)
    bundle.destinations.create(name="Postdesk: GG", folder_id=root)
    env["VARIMO_HQ_API_KEYS_JSON"] = json.dumps([{
        "sha256": hashlib.sha256(API_KEY.encode()).hexdigest(), "scope": "varimo:jobs",
        "workspace_id": ws, "email": "jeff@x.com", "models": ["GG"],
        "expires_at": time.time() + 3600,
    }])
    target = {"source_file_id": fid, "model": "GG", "page": "page-a", "winner": "trial-123"}
    api = TestClient(app)
    return api, {"Authorization": "Bearer " + API_KEY}, target, bundle, c


def test_motion_off_accepted_and_reaches_runner(hq):
    api, headers, target, bundle, _c = hq
    r = api.post("/api/hq/jobs", json={"target": target, "count": 1, "motion": "off"},
                 headers=headers)
    assert r.status_code == 200, r.text
    job = bundle.store.get(r.json()["job_id"])
    assert job.motion == "off"
    assert bundle.store.wait(job.job_id, timeout=5)
    assert bundle.store._runner.last_motion == "off"
    assert _job_from_dict(_job_to_dict(job)).motion == "off"
    # identical retry is idempotent
    again = api.post("/api/hq/jobs", json={"target": target, "count": 1, "motion": "off"},
                     headers=headers)
    assert again.status_code == 200 and again.json()["job_id"] == job.job_id


def test_absent_motion_is_todays_behavior(hq):
    api, headers, target, bundle, _c = hq
    r = api.post("/api/hq/jobs", json={"target": target, "count": 1}, headers=headers)
    assert r.status_code == 200, r.text
    job = bundle.store.get(r.json()["job_id"])
    assert job.motion is None
    assert bundle.store.wait(job.job_id, timeout=5)
    assert bundle.store._runner.last_motion is None


@pytest.mark.parametrize("bad", ["on", "OFF", "", None, True, 0, ["off"]])
def test_invalid_motion_is_400(hq, bad):
    api, headers, target, bundle, _c = hq
    r = api.post("/api/hq/jobs", json={"target": target, "count": 1, "motion": bad},
                 headers=headers)
    assert r.status_code == 400, r.text
    assert bundle.store.list() == []


def test_unknown_extra_key_still_400(hq):
    api, headers, target, _b, _c = hq
    r = api.post("/api/hq/jobs", json={"target": target, "count": 1, "speed": "off"},
                 headers=headers)
    assert r.status_code == 400


def test_conflicting_motion_is_409_both_directions(hq):
    api, headers, target, bundle, _c = hq
    body = {"target": target, "count": 1}
    assert api.post("/api/hq/jobs", json=body, headers=headers).status_code == 200
    r = api.post("/api/hq/jobs", json={**body, "motion": "off"}, headers=headers)
    assert r.status_code == 409 and "motion" in r.json()["detail"]
    assert len(bundle.store.list()) == 1


def test_conflicting_motion_off_then_default_is_409(hq):
    api, headers, target, bundle, c = hq
    body = {"target": target, "count": 1}
    assert api.post("/api/hq/jobs", json={**body, "motion": "off"},
                    headers=headers).status_code == 200
    assert api.post("/api/hq/jobs", json=body, headers=headers).status_code == 409
    assert len(bundle.store.list()) == 1
    # Manual-fallback generate adopts the stored motion instead of conflicting.
    hid = api.post("/api/hq/jobs", json={**body, "motion": "off"},
                   headers=headers).json()["operation_id"]
    assert c.post(f"/api/hq/targets/{hid}/generate?count=1").status_code == 200
    assert len(bundle.store.list()) == 1
