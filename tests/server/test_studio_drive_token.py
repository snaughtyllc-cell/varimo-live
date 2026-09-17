"""Site-level studio@ Drive OAuth token (auth ON). Customers never connect Google."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server import drive_config as dc
from variant_maker.server.app import create_app
from variant_maker.server.destinations import DestinationStore
from variant_maker.server.drive_oauth import OAuthTokenStore
from variant_maker.server.jobs import JobStore
from variant_maker.server.tenants import ADMIN_EMAIL_ENV, tenant_root
from variant_maker.server.workspace import Workspace

ADMIN = "jeff@x.com"
SECRET = "test-auth-secret"


def _env() -> dict[str, str]:
    return {
        ADMIN_EMAIL_ENV: ADMIN,
        "VARIANT_AUTH_SECRET": SECRET,
        dc.ENV_OAUTH_CLIENT_ID: "test-client-id",
        dc.ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
        dc.ENV_OAUTH_REDIRECT_URI: "https://ui.example/api/drive/oauth/callback",
    }


def _exchange(*, code: str, **_kwargs):
    mapping = {
        "jeff": {"email": ADMIN, "name": "Jeff"},
        "ops": {"email": "ops@x.com", "name": "Ops"},
        "creator": {"email": "creator@x.com", "name": "Creator"},
    }
    return mapping[code]


def _auth_app(tmp_path, *, hydrate=True, extra_env: dict | None = None,
              oauth_exchange=None, oauth_fetch_email=None):
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
        oauth_exchange=oauth_exchange,
        oauth_fetch_email=oauth_fetch_email,
        sa_json_path="",
    )
    return app, store


def _password_login(client: TestClient, email: str, password: str, session_id: str = ""):
    body = {"email": email, "password": password}
    if session_id:
        body["session_id"] = session_id
    return client.post("/api/auth/password", json=body)


def _login(client: TestClient, code: str):
    start = client.get("/api/auth/google/start", follow_redirects=False)
    assert start.status_code in (302, 307)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    return client.get(
        f"/api/auth/google/callback?code={code}&state={state}",
        follow_redirects=False,
    )


def _write_token(path: str | Path, email: str) -> None:
    store = OAuthTokenStore(str(path))
    store.save({
        "refresh_token": "rt",
        "token": "at",
        "client_id": "cid",
        "client_secret": "sec",
        "email": email,
    })


def _invite_second_workspace(admin: TestClient, email: str) -> None:
    inv = admin.post("/api/auth/invites", json={"email": email, "kind": "new_workspace"})
    assert inv.status_code == 201, inv.text


def test_site_token_makes_second_workspace_drive_ready(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    ops_me = ops.get("/api/auth/me").json()
    ops_token = Path(tenant_root(str(tmp_path), ops_me["workspace_id"])) / "drive" / "oauth_token.json"
    assert not ops_token.is_file()

    site = dc.studio_oauth_token_path(str(tmp_path), {})
    _write_token(site, "studio@varimo.io")

    status = ops.get("/api/drive/status").json()
    assert status["status"] == "ready"
    assert status["auth_mode"] == "oauth"
    assert status["connected_email"] == "studio@varimo.io"
    assert not ops_token.is_file()


def test_second_workspace_destinations_do_not_inherit_admin(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    jeff_me = jeff.get("/api/auth/me").json()
    admin_dest = DestinationStore(
        str(Path(tenant_root(str(tmp_path), jeff_me["workspace_id"])) / "drive" / "destinations.json"),
    )
    admin_dest.create(name="Jeff Reels", folder_id="folderABC123456")
    assert jeff.get("/api/drive/destinations").json()

    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    site = dc.studio_oauth_token_path(str(tmp_path), {})
    _write_token(site, "studio@varimo.io")
    assert ops.get("/api/drive/status").json()["status"] == "ready"
    assert ops.get("/api/drive/destinations").json() == []


def test_non_admin_cannot_start_drive_oauth_when_auth_on(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    resp = ops.get("/api/drive/oauth/start", follow_redirects=False)
    assert resp.status_code == 403


def test_admin_can_start_drive_oauth_when_auth_on(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    assert _password_login(jeff, ADMIN, "secret12").status_code == 200

    resp = jeff.get("/api/drive/oauth/start", follow_redirects=False)
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "accounts.google.com" in loc
    assert "test-client-id" in loc


def test_customer_leftover_token_is_ignored_for_status(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    ops_me = ops.get("/api/auth/me").json()
    leftover = Path(tenant_root(str(tmp_path), ops_me["workspace_id"])) / "drive" / "oauth_token.json"
    _write_token(leftover, "leftover@customer.com")

    site = dc.studio_oauth_token_path(str(tmp_path), {})
    _write_token(site, "studio@varimo.io")

    status = ops.get("/api/drive/status").json()
    assert status["status"] == "ready"
    assert status["connected_email"] == "studio@varimo.io"
    assert status["connected_email"] != "leftover@customer.com"


def test_admin_oauth_callback_saves_site_token_not_workspace(tmp_path):
    def fake_exchange(**_kwargs):
        return {"token": "access-1", "refresh_token": "refresh-1"}

    app, _ = _auth_app(
        tmp_path,
        oauth_exchange=fake_exchange,
        oauth_fetch_email=lambda _: "studio@varimo.io",
    )
    jeff = TestClient(app)
    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    jeff_me = jeff.get("/api/auth/me").json()
    workspace_token = Path(
        tenant_root(str(tmp_path), jeff_me["workspace_id"]),
    ) / "drive" / "oauth_token.json"

    start = jeff.get("/api/drive/oauth/start", follow_redirects=False)
    assert start.status_code in (302, 307)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    resp = jeff.get(
        f"/api/drive/oauth/callback?code=auth-code-1&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    assert "oauth=connected" in resp.headers["location"]

    site = dc.studio_oauth_token_path(str(tmp_path), {})
    assert OAuthTokenStore(site).exists()
    assert json.loads(Path(site).read_text())["email"] == "studio@varimo.io"
    assert not workspace_token.is_file()


def test_every_workspace_uses_the_same_studio_token(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    creator = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    _invite_second_workspace(jeff, "creator@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200
    assert _password_login(creator, "creator@x.com", "creator-secret").status_code == 200

    site = dc.studio_oauth_token_path(str(tmp_path), {})
    _write_token(site, "studio@varimo.io")

    for client in (jeff, ops, creator):
        status = client.get("/api/drive/status").json()
        assert status["status"] == "ready"
        assert status["connected_email"] == "studio@varimo.io"
        assert status["share_email"] == "studio@varimo.io"


def test_unlabeled_admin_token_makes_customer_drive_ready(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    jeff_me = jeff.get("/api/auth/me").json()
    admin_token = Path(
        tenant_root(str(tmp_path), jeff_me["workspace_id"]),
    ) / "drive" / "oauth_token.json"
    admin_token.parent.mkdir(parents=True, exist_ok=True)
    admin_token.write_text(json.dumps({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
    }))

    status = ops.get("/api/drive/status").json()
    assert status["status"] == "ready"


def test_admin_personal_gmail_is_not_shared_with_customers(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)

    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    _invite_second_workspace(jeff, "ops@x.com")
    assert _password_login(ops, "ops@x.com", "ops-secret").status_code == 200

    jeff_me = jeff.get("/api/auth/me").json()
    admin_token = Path(
        tenant_root(str(tmp_path), jeff_me["workspace_id"]),
    ) / "drive" / "oauth_token.json"
    _write_token(admin_token, "jeff@x.com")

    status = ops.get("/api/drive/status").json()
    assert status["status"] == "not_configured"
    assert status["connected_email"] in (None, "")


def test_admin_disconnect_clears_site_and_admin_fallback(tmp_path):
    app, _ = _auth_app(tmp_path)
    jeff = TestClient(app)
    assert _password_login(jeff, ADMIN, "secret12").status_code == 200
    jeff_me = jeff.get("/api/auth/me").json()
    admin_token = Path(
        tenant_root(str(tmp_path), jeff_me["workspace_id"]),
    ) / "drive" / "oauth_token.json"
    _write_token(admin_token, "studio@varimo.io")

    assert jeff.get("/api/drive/status").json()["status"] == "ready"
    assert jeff.get("/api/drive/status").json()["connected_email"] == "studio@varimo.io"
    resp = jeff.post("/api/drive/oauth/disconnect")
    assert resp.status_code == 200
    assert jeff.get("/api/drive/status").json()["status"] == "not_configured"
    assert not admin_token.is_file()
    assert not Path(dc.studio_oauth_token_path(str(tmp_path), {})).is_file()
