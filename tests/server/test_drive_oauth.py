"""OAuth Drive sign-in: token store, status resolution, start/callback/disconnect (no live Google)."""
from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from farm_fakes import FakeDrive
from tests.server.fakes import FakeRunner
from variant_maker.server import drive_config as dc
from variant_maker.server.app import create_app
from variant_maker.server.drive_oauth import OAuthTokenStore, build_authorization_url
from variant_maker.server.jobs import JobStore
from variant_maker.server.workspace import Workspace


def test_workspace_oauth_token_path(tmp_path):
    ws = Workspace(str(tmp_path))
    path = ws.oauth_token_path()
    assert path.endswith(("drive/oauth_token.json", "drive\\oauth_token.json"))
    pending = ws.oauth_pending_path()
    assert pending.endswith(("drive/oauth_pending.json", "drive\\oauth_pending.json"))


def test_oauth_token_store_roundtrip(tmp_path):
    path = str(tmp_path / "oauth_token.json")
    store = OAuthTokenStore(path)
    assert store.exists() is False
    store.save({"refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
                "scopes": ["https://www.googleapis.com/auth/drive.file"],
                "email": "ops@company.com"})
    assert store.exists() is True
    data = store.load()
    assert data["refresh_token"] == "rt"
    assert data["email"] == "ops@company.com"
    store.clear()
    assert store.exists() is False


def test_build_authorization_url_includes_offline_and_scope():
    url = build_authorization_url(
        client_id="cid.apps.googleusercontent.com",
        redirect_uri="https://example.com/api/drive/oauth/callback",
        state="abc123",
    )
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert parsed.netloc == "accounts.google.com"
    assert qs["client_id"] == ["cid.apps.googleusercontent.com"]
    assert qs["redirect_uri"] == ["https://example.com/api/drive/oauth/callback"]
    assert qs["response_type"] == ["code"]
    assert qs["access_type"] == ["offline"]
    assert qs["prompt"] == ["consent"]
    assert qs["state"] == ["abc123"]
    assert "drive.file" in qs["scope"][0]
    assert "spreadsheets" in qs["scope"][0]


def test_status_oauth_ready_when_token_present(tmp_path, monkeypatch):
    monkeypatch.delenv(dc.ENV_SA_JSON, raising=False)
    token_path = tmp_path / "oauth_token.json"
    token_path.write_text(json.dumps({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
        "email": "ops@company.com",
    }))
    info = dc.resolve_drive_status(
        sa_json_path=None,
        oauth_token_path=str(token_path),
        environ={
            dc.ENV_OAUTH_CLIENT_ID: "cid",
            dc.ENV_OAUTH_CLIENT_SECRET: "sec",
        },
    )
    assert info.status == "ready"
    assert info.auth_mode == "oauth"
    assert info.connected_email == "ops@company.com"
    assert info.sa_email == "ops@company.com"  # back-compat alias
    assert info.oauth_available is True


def test_status_oauth_available_but_not_connected(tmp_path, monkeypatch):
    monkeypatch.delenv(dc.ENV_SA_JSON, raising=False)
    info = dc.resolve_drive_status(
        sa_json_path=None,
        oauth_token_path=str(tmp_path / "missing.json"),
        environ={
            dc.ENV_OAUTH_CLIENT_ID: "cid",
            dc.ENV_OAUTH_CLIENT_SECRET: "sec",
        },
    )
    assert info.status == "not_configured"
    assert info.oauth_available is True
    assert info.auth_mode is None
    assert "Connect Google" not in info.message
    assert "share" in info.message.lower() or "studio" in info.message.lower()


def test_status_prefers_oauth_over_sa(tmp_path):
    sa = tmp_path / "sa.json"
    sa.write_text(json.dumps({"client_email": "bot@project.iam.gserviceaccount.com"}))
    token = tmp_path / "oauth_token.json"
    token.write_text(json.dumps({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
        "email": "ops@company.com",
    }))
    info = dc.resolve_drive_status(
        sa_json_path=str(sa),
        oauth_token_path=str(token),
        environ={
            dc.ENV_OAUTH_CLIENT_ID: "cid",
            dc.ENV_OAUTH_CLIENT_SECRET: "sec",
        },
    )
    assert info.status == "ready"
    assert info.auth_mode == "oauth"
    assert info.connected_email == "ops@company.com"


def test_status_sa_still_works_without_oauth(tmp_path, monkeypatch):
    monkeypatch.delenv(dc.ENV_OAUTH_CLIENT_ID, raising=False)
    monkeypatch.delenv(dc.ENV_OAUTH_CLIENT_SECRET, raising=False)
    sa = tmp_path / "sa.json"
    sa.write_text(json.dumps({"client_email": "bot@project.iam.gserviceaccount.com"}))
    info = dc.resolve_drive_status(sa_json_path=str(sa), oauth_token_path=None, environ={})
    assert info.status == "ready"
    assert info.auth_mode == "service_account"
    assert info.connected_email == "bot@project.iam.gserviceaccount.com"
    assert info.oauth_available is False


def _oauth_app(tmp_path, *, drive=None, exchange=None, fetch_email=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    env = {
        dc.ENV_OAUTH_CLIENT_ID: "test-client-id",
        dc.ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
        dc.ENV_OAUTH_REDIRECT_URI: "https://ui.example/api/drive/oauth/callback",
    }
    app = create_app(
        store,
        drive=drive,
        sa_json_path="",
        oauth_token_path=ws.oauth_token_path(),
        oauth_environ=env,
        oauth_exchange=exchange,
        oauth_fetch_email=fetch_email,
    )
    return TestClient(app), ws


def test_oauth_start_redirects_to_google(tmp_path):
    client, _ = _oauth_app(tmp_path)
    resp = client.get("/api/drive/oauth/start", follow_redirects=False)
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "accounts.google.com" in loc
    assert "test-client-id" in loc


def test_oauth_start_503_when_client_not_configured(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    client = TestClient(create_app(store, drive=None, sa_json_path="", oauth_environ={}))
    resp = client.get("/api/drive/oauth/start", follow_redirects=False)
    assert resp.status_code == 503


def test_oauth_callback_missing_code_redirects_with_reason(tmp_path):
    client, _ = _oauth_app(tmp_path)
    resp = client.get("/api/drive/oauth/callback?state=abc", follow_redirects=False)
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "oauth=error" in loc
    assert "missing_code" in loc
    assert loc.startswith("http")  # absolute, so Next.js proxy cannot resolve against :8000


def test_oauth_state_survives_process_restart(tmp_path):
    """Railway/Next can hit a new FastAPI process on callback; memory-only CSRF fails."""
    def fake_exchange(**_kwargs):
        return {"token": "access-1", "refresh_token": "refresh-1"}

    client1, ws = _oauth_app(tmp_path, exchange=fake_exchange, fetch_email=lambda _: "ops@company.com")
    start = client1.get("/api/drive/oauth/start", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]

    client2, _ = _oauth_app(tmp_path, exchange=fake_exchange, fetch_email=lambda _: "ops@company.com")
    resp = client2.get(
        f"/api/drive/oauth/callback?code=auth-code-1&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    assert "oauth=connected" in resp.headers["location"]
    assert OAuthTokenStore(ws.oauth_token_path()).exists()


def test_oauth_callback_saves_token_and_redirects(tmp_path):
    def fake_exchange(*, code, client_id, client_secret, redirect_uri):
        assert code == "auth-code-1"
        assert client_id == "test-client-id"
        assert redirect_uri == "https://ui.example/api/drive/oauth/callback"
        return {
            "token": "access-1",
            "refresh_token": "refresh-1",
            "client_id": client_id,
            "client_secret": client_secret,
            "scopes": ["https://www.googleapis.com/auth/drive.file"],
        }

    def fake_email(_token_data):
        return "ops@company.com"

    client, ws = _oauth_app(tmp_path, exchange=fake_exchange, fetch_email=fake_email)
    # Prime state via start
    start = client.get("/api/drive/oauth/start", follow_redirects=False)
    qs = parse_qs(urlparse(start.headers["location"]).query)
    state = qs["state"][0]

    resp = client.get(
        f"/api/drive/oauth/callback?code=auth-code-1&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    assert "/settings/drive" in resp.headers["location"]

    token = json.loads(open(ws.oauth_token_path()).read())
    assert token["refresh_token"] == "refresh-1"
    assert token["email"] == "ops@company.com"

    status = client.get("/api/drive/status").json()
    assert status["status"] == "ready"
    assert status["auth_mode"] == "oauth"
    assert status["connected_email"] == "ops@company.com"
    assert status["oauth_available"] is True
    assert status["share_email"] == "studio@varimo.io"


def test_oauth_disconnect_clears_token(tmp_path):
    client, ws = _oauth_app(tmp_path)
    OAuthTokenStore(ws.oauth_token_path()).save({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
        "email": "ops@company.com",
    })
    # Re-create app so status picks up token — refresh via disconnect after injecting drive
    drive = FakeDrive()
    client2, ws2 = _oauth_app(tmp_path, drive=drive)
    OAuthTokenStore(ws2.oauth_token_path()).save({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
        "email": "ops@company.com",
    })
    # Force ready by rebuilding with drive already set and token on disk
    store = JobStore(ws2, FakeRunner({}))
    env = {
        dc.ENV_OAUTH_CLIENT_ID: "test-client-id",
        dc.ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
        dc.ENV_OAUTH_REDIRECT_URI: "https://ui.example/api/drive/oauth/callback",
    }
    app = create_app(
        store, drive=drive, sa_json_path="",
        oauth_token_path=ws2.oauth_token_path(), oauth_environ=env,
    )
    client3 = TestClient(app)
    assert client3.get("/api/drive/status").json()["status"] == "ready"

    resp = client3.post("/api/drive/oauth/disconnect")
    assert resp.status_code == 200
    assert not OAuthTokenStore(ws2.oauth_token_path()).exists()
    body = client3.get("/api/drive/status").json()
    assert body["status"] == "not_configured"
    assert body["oauth_available"] is True


def test_create_destination_auth_mode_oauth(tmp_path):
    drive = FakeDrive()
    folder = drive.make_folder("shared")
    client, ws = _oauth_app(tmp_path, drive=drive)
    OAuthTokenStore(ws.oauth_token_path()).save({
        "refresh_token": "rt", "token": "at", "client_id": "cid", "client_secret": "sec",
        "email": "ops@company.com",
    })
    store = JobStore(ws, FakeRunner({}))
    env = {
        dc.ENV_OAUTH_CLIENT_ID: "test-client-id",
        dc.ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
        dc.ENV_OAUTH_REDIRECT_URI: "https://ui.example/api/drive/oauth/callback",
    }
    app = create_app(
        store, drive=drive, sa_json_path="",
        oauth_token_path=ws.oauth_token_path(), oauth_environ=env,
    )
    client = TestClient(app)
    resp = client.post("/api/drive/destinations", json={
        "name": "Reels",
        "folder_url": f"https://drive.google.com/drive/folders/{folder}",
    })
    assert resp.status_code == 201
    assert resp.json()["auth_mode"] == "oauth"
