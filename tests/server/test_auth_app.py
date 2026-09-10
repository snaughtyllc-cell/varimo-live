"""Invite-only Google login, per-workspace isolation, admin view switcher."""
from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.drive_config import ENV_OAUTH_CLIENT_ID, ENV_OAUTH_CLIENT_SECRET
from variant_maker.server.drive_oauth import (
    login_profile_from_token,
    resolve_login_profile,
    resolve_login_redirect_uri,
)
from variant_maker.server.jobs import JobStore
from variant_maker.server.sessions import COOKIE_NAME, VIEW_COOKIE_NAME
from variant_maker.server.tenants import ADMIN_EMAIL_ENV, SITE_ADMIN_EMAILS_ENV
from variant_maker.server.workspace import Workspace

ADMIN = "jeff@x.com"
SECRET = "test-auth-secret"


def _env() -> dict[str, str]:
    return {
        ADMIN_EMAIL_ENV: ADMIN,
        "VARIANT_AUTH_SECRET": SECRET,
        ENV_OAUTH_CLIENT_ID: "test-client-id",
        ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
    }


def _exchange(*, code: str, **_kwargs):
    mapping = {
        "jeff": {"email": ADMIN, "name": "Jeff"},
        "va": {"email": "va@x.com", "name": "VA"},
        "ops": {"email": "ops@x.com", "name": "Ops"},
        "creator": {"email": "creator@x.com", "name": "Creator"},
        "partner": {"email": "partner@x.com", "name": "Partner"},
        "stranger": {"email": "stranger@x.com", "name": "Stranger"},
    }
    return mapping[code]


def _auth_app(tmp_path, *, hydrate=True, extra_env: dict | None = None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    env = _env()
    if extra_env:
        env.update(extra_env)
    app = create_app(
        store,
        hydrate=hydrate,
        auth_environ=env,
        oauth_environ=env,
        login_exchange=_exchange,
        sa_json_path="",
    )
    return app, store


def _start_state(client: TestClient) -> str:
    resp = client.get("/api/auth/google/start", follow_redirects=False)
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "accounts.google.com" in loc
    assert "openid" in loc
    qs = parse_qs(urlparse(loc).query)
    return qs["state"][0]


def _login(client: TestClient, code: str):
    state = _start_state(client)
    return client.get(
        f"/api/auth/google/callback?code={code}&state={state}",
        follow_redirects=False,
    )


def _set_experience(admin: TestClient, workspace_id: str, experience: str) -> None:
    r = admin.patch(
        f"/api/admin/workspaces/{workspace_id}", json={"experience": experience},
    )
    assert r.status_code == 200, r.text


def _tenant_wait(client: TestClient, job_id: str, timeout: float = 5) -> None:
    me = client.get("/api/auth/me").json()
    store = client.app.state.tenant_hub.bundle(me["workspace_id"]).store
    assert store.wait(job_id, timeout=timeout)


def test_login_profile_from_id_token():
    payload = base64.urlsafe_b64encode(
        json.dumps({"email": "a@b.com", "name": "Ann"}).encode(),
    ).decode().rstrip("=")
    email, name = login_profile_from_token({"id_token": f"x.{payload}.y"})
    assert email == "a@b.com" and name == "Ann"


def test_resolve_login_profile_falls_back_to_userinfo():
    email, name = resolve_login_profile(
        {"token": "ya29.access"},
        get_json=lambda _url, _headers: {"email": "jeff@x.com", "name": "Jeff"},
    )
    assert email == "jeff@x.com" and name == "Jeff"


def test_resolve_login_redirect_uri():
    assert resolve_login_redirect_uri(
        {}, request_base="https://studio.example",
    ) == "https://studio.example/api/auth/google/callback"
    assert resolve_login_redirect_uri(
        {"VARIANT_AUTH_OAUTH_REDIRECT_URI": "https://x/cb"},
    ) == "https://x/cb"


def test_me_auth_off(tmp_path):
    client = TestClient(create_app(JobStore(Workspace(str(tmp_path)), FakeRunner({}))))
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["auth_required"] is False
    assert body["email"] is None
    assert body["is_admin"] is False
    assert client.get("/api/gallery").status_code == 200
    assert client.get("/api/auth/google/start").status_code == 404


def test_gallery_401_without_session(tmp_path):
    app, _ = _auth_app(tmp_path)
    anon = TestClient(app)
    assert anon.get("/api/health").status_code == 200
    me = anon.get("/api/auth/me").json()
    assert me["auth_required"] is True and me["email"] is None
    assert anon.get("/api/gallery").status_code == 401
    assert anon.get("/api/queue").status_code == 401
    assert anon.get("/api/variants/abc/v01.mp4").status_code == 401
    assert anon.get("/api/sources/abc/source").status_code == 401


def test_uninvited_google_email_does_not_set_cookie(tmp_path):
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    resp = _login(client, "stranger")
    assert resp.status_code in (302, 307)
    assert "error=not_invited" in resp.headers["location"]
    assert not client.cookies.get(COOKIE_NAME)
    assert client.get("/api/gallery").status_code == 401


def test_admin_login_and_join_invite_share_gallery(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    va = TestClient(app)

    resp = _login(jeff, "jeff")
    assert resp.status_code in (302, 307)
    me = jeff.get("/api/auth/me").json()
    assert me["email"] == ADMIN
    assert me["is_admin"] is True
    assert me["role"] == "owner"
    assert me["viewing_other"] is False

    created = jeff.post(
        "/api/jobs",
        files=[("files", ("shared.mp4", b"x", "video/mp4"))],
        data={"count": "1"},
    )
    assert created.status_code == 201
    job_id = created.json()["job_id"]
    _tenant_wait(jeff, job_id)
    gallery = jeff.get("/api/gallery").json()
    assert [s["filename"] for s in gallery] == ["shared.mp4"]
    source_id = gallery[0]["source_id"]
    filename = gallery[0]["variants"][0]["filename"]

    inv = jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    assert inv.status_code == 201
    assert inv.json()["kind"] == "join"
    assert inv.json()["workspace_id"] == me["home_workspace_id"]

    listed = jeff.get("/api/auth/invites").json()
    assert len(listed) == 1

    resp = _login(va, "va")
    assert resp.status_code in (302, 307)
    va_me = va.get("/api/auth/me").json()
    assert va_me["email"] == "va@x.com"
    assert va_me["is_admin"] is False
    assert va_me["role"] == "member"
    assert va_me["workspace_id"] == me["workspace_id"]
    assert [s["filename"] for s in va.get("/api/gallery").json()] == ["shared.mp4"]
    assert va.get(f"/api/variants/{source_id}/{filename}").status_code == 200
    assert va.get("/api/admin/workspaces").status_code == 403
    assert va.post(
        "/api/auth/invites", json={"email": "x@y.com", "kind": "join"},
    ).status_code == 403

    spaces = jeff.get("/api/admin/workspaces").json()
    home = next(s for s in spaces if s["id"] == me["workspace_id"])
    assert {m["email"] for m in home["members"]} == {ADMIN, "va@x.com"}
    assert all("password_hash" not in m for m in home["members"])
    assert home["member_count"] == 2


def test_new_workspace_invite_isolates_galleries(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    anon = TestClient(app)

    _login(jeff, "jeff")
    created = jeff.post(
        "/api/jobs",
        files=[("files", ("jeff.mp4", b"j", "video/mp4"))],
        data={"count": "1"},
    )
    _tenant_wait(jeff, created.json()["job_id"])
    jeff_gal = jeff.get("/api/gallery").json()
    source_id = jeff_gal[0]["source_id"]
    filename = jeff_gal[0]["variants"][0]["filename"]

    inv = jeff.post(
        "/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"},
    )
    assert inv.status_code == 201
    assert inv.json()["workspace_id"] is None

    _login(ops, "ops")
    ops_me = ops.get("/api/auth/me").json()
    jeff_me = jeff.get("/api/auth/me").json()
    assert ops_me["workspace_id"] != jeff_me["workspace_id"]
    assert ops_me["role"] == "owner"
    assert ops_me["plan"] == "creator"
    assert ops_me["experience"] == "solo"
    assert jeff_me["plan"] == "internal"
    assert ops_me["usage"]["meter_line"] == "Creator · 0 of 12 packs this month"
    assert ops_me["usage"]["remaining_pct"] == 100
    assert jeff_me["usage"] is None
    assert ops.get("/api/gallery").json() == []
    assert ops.get(f"/api/variants/{source_id}/{filename}").status_code == 404
    assert ops.get(f"/api/sources/{source_id}/source").status_code == 404
    assert anon.get("/api/gallery").status_code == 401

    ops_job = ops.post(
        "/api/jobs",
        files=[("files", ("ops.mp4", b"o", "video/mp4"))],
        data={"count": "1"},
    )
    _tenant_wait(ops, ops_job.json()["job_id"])
    assert [s["filename"] for s in ops.get("/api/gallery").json()] == ["ops.mp4"]
    assert [s["filename"] for s in jeff.get("/api/gallery").json()] == ["jeff.mp4"]


def test_admin_view_switches_gallery_then_exits_home(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")

    jeff_job = jeff.post(
        "/api/jobs",
        files=[("files", ("jeff.mp4", b"j", "video/mp4"))],
        data={"count": "1"},
    )
    _tenant_wait(jeff, jeff_job.json()["job_id"])
    ops_job = ops.post(
        "/api/jobs",
        files=[("files", ("ops.mp4", b"o", "video/mp4"))],
        data={"count": "1"},
    )
    _tenant_wait(ops, ops_job.json()["job_id"])

    spaces = jeff.get("/api/admin/workspaces").json()
    assert len(spaces) == 2
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    row = next(s for s in spaces if s["id"] == ops_id)
    assert row["owner_email"] == "ops@x.com"
    assert row["last_job_utc"]

    switched = jeff.post("/api/admin/view", json={"workspace_id": ops_id})
    assert switched.status_code == 204
    assert jeff.cookies.get(VIEW_COOKIE_NAME)
    me = jeff.get("/api/auth/me").json()
    assert me["viewing_other"] is True
    assert me["workspace_id"] == ops_id
    assert me["home_workspace_id"] != ops_id
    assert [s["filename"] for s in jeff.get("/api/gallery").json()] == ["ops.mp4"]

    home = jeff.post("/api/admin/view", json={"workspace_id": None})
    assert home.status_code == 204
    me = jeff.get("/api/auth/me").json()
    assert me["viewing_other"] is False
    assert [s["filename"] for s in jeff.get("/api/gallery").json()] == ["jeff.mp4"]


def test_logout_clears_session(tmp_path):
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    _login(client, "jeff")
    assert client.get("/api/gallery").status_code == 200
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 204
    assert client.get("/api/gallery").status_code == 401


def test_admin_login_migrates_legacy_jobs(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("legacy.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    env = _env()
    app = create_app(
        store,
        hydrate=False,
        auth_environ=env,
        oauth_environ=env,
        login_exchange=_exchange,
        sa_json_path="",
    )
    client = TestClient(app)
    _login(client, "jeff")
    _tenant_wait(client, job.job_id)
    gallery = client.get("/api/gallery").json()
    assert [s["filename"] for s in gallery] == ["legacy.mp4"]


def test_delete_invite(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    _login(jeff, "jeff")
    inv = jeff.post(
        "/api/auth/invites", json={"email": "n@x.com", "kind": "new_workspace"},
    ).json()
    assert jeff.delete(f"/api/auth/invites/{inv['id']}").status_code == 204
    assert jeff.get("/api/auth/invites").json() == []
    assert jeff.delete(f"/api/auth/invites/{inv['id']}").status_code == 404


def test_admin_remove_member_revokes_login(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    va = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    _login(va, "va")
    assert va.get("/api/gallery").status_code == 200

    removed = jeff.delete("/api/admin/users/va@x.com")
    assert removed.status_code == 204
    spaces = jeff.get("/api/admin/workspaces").json()
    home = next(s for s in spaces if s["id"] == jeff.get("/api/auth/me").json()["home_workspace_id"])
    assert [m["email"] for m in home["members"]] == [ADMIN]
    assert va.get("/api/gallery").status_code == 401
    again = _login(va, "va")
    assert again.status_code in (302, 307)
    assert "error=not_invited" in again.headers["location"]
    assert jeff.delete("/api/admin/users/va@x.com").status_code == 404
    assert jeff.delete(f"/api/admin/users/{ADMIN}").status_code == 400
    anon = TestClient(app)
    assert anon.delete("/api/admin/users/x@y.com").status_code == 401


def test_non_admin_cannot_remove_users(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    va = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    _login(va, "va")
    assert va.delete(f"/api/admin/users/{ADMIN}").status_code == 403
    assert jeff.get("/api/auth/me").json()["email"] == ADMIN


def test_workspace_owner_invites_and_removes_own_va(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    helper = TestClient(app)
    va = TestClient(app)

    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    assert ops.get("/api/auth/me").json()["experience"] == "solo"
    _set_experience(jeff, ops_id, "agency")
    jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    _login(va, "va")

    assert va.get("/api/workspace/team").status_code == 403
    team = ops.get("/api/workspace/team").json()
    assert team["workspace_id"] == ops_id
    assert {m["email"] for m in team["members"]} == {"ops@x.com"}

    inv = ops.post("/api/workspace/invites", json={"email": "helper@x.com"})
    assert inv.status_code == 201
    assert inv.json()["kind"] == "join"
    assert inv.json()["workspace_id"] == ops_id
    assert ops.post(
        "/api/auth/invites", json={"email": "z@x.com", "kind": "new_workspace"},
    ).status_code == 403

    pending = ops.get("/api/workspace/team").json()["invites"]
    assert [i["email"] for i in pending] == ["helper@x.com"]
    assert jeff.delete(f"/api/workspace/invites/{pending[0]['id']}").status_code == 404
    assert ops.delete(f"/api/workspace/invites/{pending[0]['id']}").status_code == 204
    assert ops.get("/api/workspace/team").json()["invites"] == []
    inv = ops.post("/api/workspace/invites", json={"email": "helper@x.com"})
    assert inv.status_code == 201

    first = _password_login(helper, "helper@x.com", "helper-secret")
    assert first.status_code == 200
    assert first.json()["workspace_id"] == ops_id
    assert first.json()["role"] == "member"
    assert first.json()["email"] == "helper@x.com"

    listed = ops.get("/api/workspace/team").json()
    assert {m["email"] for m in listed["members"]} == {"ops@x.com", "helper@x.com"}
    assert ops.delete(f"/api/workspace/members/{ADMIN}").status_code == 400
    assert ops.delete("/api/workspace/members/ops@x.com").status_code == 400
    removed = ops.delete("/api/workspace/members/helper@x.com")
    assert removed.status_code == 204
    assert helper.get("/api/gallery").status_code == 401


def test_admin_team_invites_home_even_when_viewing_other(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    home_id = jeff.get("/api/auth/me").json()["home_workspace_id"]

    switched = jeff.post("/api/admin/view", json={"workspace_id": ops_id})
    assert switched.status_code == 204
    me = jeff.get("/api/auth/me").json()
    assert me["viewing_other"] is True
    assert me["workspace_id"] == ops_id

    team = jeff.get("/api/workspace/team").json()
    assert team["workspace_id"] == home_id
    inv = jeff.post("/api/workspace/invites", json={"email": "homeva@x.com"})
    assert inv.status_code == 201
    assert inv.json()["workspace_id"] == home_id
    assert inv.json()["workspace_id"] != ops_id


def _password_login(client: TestClient, email: str, password: str):
    return client.post("/api/auth/password", json={"email": email, "password": password})


def test_password_login_404_when_auth_off(tmp_path):
    client = TestClient(create_app(JobStore(Workspace(str(tmp_path)), FakeRunner({}))))
    resp = client.post("/api/auth/password", json={"email": ADMIN, "password": "secret12"})
    assert resp.status_code == 404


def test_password_login_admin_first_sign_in_sets_password(tmp_path):
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    resp = _password_login(client, ADMIN, "secret12")
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == ADMIN
    assert body["is_admin"] is True
    assert body["has_password"] is True
    assert "password_hash" not in body
    assert "pbkdf2" not in resp.text
    assert client.get("/api/gallery").status_code == 200
    me = client.get("/api/auth/me").json()
    assert me["has_password"] is True
    assert "password_hash" not in me

    client.post("/api/auth/logout")
    assert client.get("/api/gallery").status_code == 401
    bad = _password_login(client, ADMIN, "wrong-pass")
    assert bad.status_code == 401
    again = _password_login(client, ADMIN, "secret12")
    assert again.status_code == 200
    assert client.get("/api/gallery").status_code == 200


def test_password_login_invite_only_and_short_password(tmp_path):
    app, _ = _auth_app(tmp_path)
    stranger = TestClient(app)
    denied = _password_login(stranger, "stranger@x.com", "secret12")
    assert denied.status_code == 401
    assert "invited" in denied.json()["detail"].lower()
    assert stranger.get("/api/gallery").status_code == 401

    jeff = TestClient(app)
    _password_login(jeff, ADMIN, "secret12")
    short = _password_login(jeff, "va@x.com", "short")
    assert short.status_code == 400

    inv = jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    assert inv.status_code == 201
    va = TestClient(app)
    first = _password_login(va, "va@x.com", "va-secret")
    assert first.status_code == 200
    assert first.json()["email"] == "va@x.com"
    assert first.json()["role"] == "member"
    assert first.json()["workspace_id"] == jeff.get("/api/auth/me").json()["workspace_id"]
    assert va.get("/api/gallery").status_code == 200


def test_google_only_account_cannot_set_password_from_login(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    _login(jeff, "jeff")
    me = jeff.get("/api/auth/me").json()
    assert me["has_password"] is False

    anon = TestClient(app)
    blocked = _password_login(anon, ADMIN, "secret12")
    assert blocked.status_code == 400
    assert "google" in blocked.json()["detail"].lower()
    assert anon.get("/api/gallery").status_code == 401

    set_pw = jeff.post("/api/auth/password/set", json={"password": "secret12"})
    assert set_pw.status_code == 204
    assert jeff.get("/api/auth/me").json()["has_password"] is True
    jeff.post("/api/auth/logout")
    again = _password_login(jeff, ADMIN, "secret12")
    assert again.status_code == 200
    assert again.json()["has_password"] is True


def test_workspace_experience_assignment(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    assert ops.get("/api/auth/me").json()["experience"] == "solo"
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    patched = jeff.patch(f"/api/admin/workspaces/{ops_id}", json={"experience": "agency"})
    assert patched.status_code == 200
    assert patched.json()["experience"] == "agency"
    assert ops.get("/api/auth/me").json()["experience"] == "agency"
    _set_experience(jeff, ops_id, "solo")
    assert ops.get("/api/auth/me").json()["experience"] == "solo"
    assert jeff.get("/api/auth/me").json()["experience"] == "agency"
    assert ops.patch(
        f"/api/admin/workspaces/{ops_id}", json={"experience": "agency"},
    ).status_code == 403


def test_solo_owner_cannot_invite_a_va(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    creator = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "creator@x.com", "kind": "new_workspace"})
    _login(creator, "creator")
    assert creator.get("/api/auth/me").json()["experience"] == "solo"
    assert creator.get("/api/workspace/team").status_code == 403
    blocked = creator.post("/api/workspace/invites", json={"email": "va@x.com"})
    assert blocked.status_code == 403
    assert "solo" in blocked.json()["detail"].lower()
    assert jeff.get("/api/workspace/team").status_code == 200


def test_second_site_admin_can_open_another_workspace(tmp_path):
    app, _ = _auth_app(tmp_path, extra_env={SITE_ADMIN_EMAILS_ENV: "partner@x.com"})
    jeff = TestClient(app)
    partner = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    _login(partner, "partner")

    me = partner.get("/api/auth/me").json()
    assert me["is_admin"] is True
    assert me["email"] == "partner@x.com"
    assert jeff.get("/api/auth/me").json()["is_admin"] is True
    assert ops.get("/api/auth/me").json()["is_admin"] is False
    assert ops.get("/api/admin/workspaces").status_code == 403

    spaces = partner.get("/api/admin/workspaces")
    assert spaces.status_code == 200
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    assert any(s["id"] == ops_id for s in spaces.json())

    switched = partner.post("/api/admin/view", json={"workspace_id": ops_id})
    assert switched.status_code == 204
    viewing = partner.get("/api/auth/me").json()
    assert viewing["viewing_other"] is True
    assert viewing["workspace_id"] == ops_id
    assert viewing["home_workspace_id"] != ops_id

    assert partner.delete(f"/api/admin/users/{ADMIN}").status_code == 400


def test_password_set_requires_login(tmp_path):
    app, _ = _auth_app(tmp_path)
    anon = TestClient(app)
    assert anon.post("/api/auth/password/set", json={"password": "secret12"}).status_code == 401


def test_admin_sets_workspace_plan_and_derive_experience(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    patched = jeff.patch(f"/api/admin/workspaces/{ops_id}", json={"plan": "studio"})
    assert patched.status_code == 200
    assert patched.json()["plan"] == "studio"
    assert patched.json()["experience"] == "agency"
    me = ops.get("/api/auth/me").json()
    assert me["plan"] == "studio"
    assert me["experience"] == "agency"
    assert "32 packs" in me["usage"]["meter_line"]


def test_payg_generate_returns_human_403(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    jeff.patch(f"/api/admin/workspaces/{ops_id}", json={"plan": "payg"})
    blocked = ops.post(
        "/api/jobs",
        files=[("files", ("clip.mp4", b"x", "video/mp4"))],
        data={"count": "8"},
    )
    assert blocked.status_code == 403
    assert "Pay as you go has no included packs" in blocked.json()["detail"]
    assert "$5.00" in blocked.json()["detail"]


def test_creator_generate_blocks_after_included_packs(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    _login(ops, "ops")
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    bundle = app.state.tenant_hub.bundle(ops_id)
    from variant_maker.server.usage import record_ok_copies
    record_ok_copies(
        bundle.ws.usage_path(),
        copies=[("src", i) for i in range(96)],
        month=None,
    )
    blocked = ops.post(
        "/api/jobs",
        files=[("files", ("clip.mp4", b"x", "video/mp4"))],
        data={"count": "8"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == (
        "Creator includes 12 packs. Extra packs are $3.50, or Studio is $79 for 32."
    )


def test_internal_workspace_stays_uncapped(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    _login(jeff, "jeff")
    created = jeff.post(
        "/api/jobs",
        files=[("files", ("clip.mp4", b"x", "video/mp4"))],
        data={"count": "8"},
    )
    assert created.status_code == 201

