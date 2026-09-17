import json

from variant_maker.server import drive_config as dc


def test_not_configured_when_env_unset(monkeypatch):
    monkeypatch.delenv(dc.ENV_SA_JSON, raising=False)
    info = dc.resolve_drive_status(environ={})
    assert info.status == "not_configured"
    assert info.sa_email is None
    assert "VARIANT_DRIVE_SERVICE_ACCOUNT_JSON" in info.message


def test_ready_reads_client_email(tmp_path, monkeypatch):
    p = tmp_path / "sa.json"
    p.write_text(json.dumps({"client_email": "bot@project.iam.gserviceaccount.com"}))
    monkeypatch.setenv(dc.ENV_SA_JSON, str(p))
    info = dc.resolve_drive_status()
    assert info.status == "ready"
    assert info.sa_email == "bot@project.iam.gserviceaccount.com"


def test_auth_failed_missing_file(tmp_path):
    info = dc.resolve_drive_status(str(tmp_path / "missing.json"))
    assert info.status == "auth_failed"
    assert "missing.json" in info.message or "unreadable" in info.message.lower()


def test_auth_failed_invalid_json(tmp_path):
    p = tmp_path / "sa.json"
    p.write_text("{not-json")
    info = dc.resolve_drive_status(str(p))
    assert info.status == "auth_failed"


def test_share_email_defaults(monkeypatch):
    monkeypatch.delenv(dc.ENV_SHARE_EMAIL, raising=False)
    assert dc.read_share_email({}) == "studio@varimo.io"


def test_share_email_from_env():
    assert dc.read_share_email({dc.ENV_SHARE_EMAIL: " ops@varyforge.app "}) == "ops@varyforge.app"


def _write_token(path, email="studio@varimo.io"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "refresh_token": "rt",
        "token": "at",
        "client_id": "cid",
        "client_secret": "sec",
        "email": email,
    }))


def test_studio_oauth_token_path_default(tmp_path, monkeypatch):
    monkeypatch.delenv(dc.ENV_STUDIO_OAUTH_TOKEN, raising=False)
    assert dc.studio_oauth_token_path(str(tmp_path), {}) == str(
        tmp_path / "auth" / "studio_oauth_token.json"
    )


def test_studio_oauth_token_path_env_override(tmp_path):
    override = str(tmp_path / "custom" / "token.json")
    assert dc.studio_oauth_token_path(
        str(tmp_path),
        {dc.ENV_STUDIO_OAUTH_TOKEN: override},
    ) == override


def test_resolve_site_token_wins_over_workspace(tmp_path):
    site = tmp_path / "auth" / "studio_oauth_token.json"
    workspace = tmp_path / "tenants" / "cust" / "drive" / "oauth_token.json"
    admin = tmp_path / "tenants" / "admin" / "drive" / "oauth_token.json"
    _write_token(site, "studio@varimo.io")
    _write_token(workspace, "customer@x.com")
    _write_token(admin, "jeff@x.com")
    resolved = dc.resolve_drive_oauth_token_path(
        data_dir=str(tmp_path),
        workspace_token_path=str(workspace),
        admin_token_paths=[str(admin)],
        environ={},
        auth_on=True,
    )
    assert resolved == str(site)


def test_resolve_admin_fallback_when_site_missing(tmp_path):
    workspace = tmp_path / "tenants" / "cust" / "drive" / "oauth_token.json"
    admin = tmp_path / "tenants" / "admin" / "drive" / "oauth_token.json"
    _write_token(workspace, "customer@x.com")
    _write_token(admin, "studio@varimo.io")
    resolved = dc.resolve_drive_oauth_token_path(
        data_dir=str(tmp_path),
        workspace_token_path=str(workspace),
        admin_token_paths=[str(admin)],
        environ={},
        auth_on=True,
    )
    assert resolved == str(admin)


def test_resolve_admin_personal_gmail_is_not_the_studio_token(tmp_path):
    workspace = tmp_path / "tenants" / "cust" / "drive" / "oauth_token.json"
    admin = tmp_path / "tenants" / "admin" / "drive" / "oauth_token.json"
    _write_token(workspace, "customer@x.com")
    _write_token(admin, "jeff@x.com")
    resolved = dc.resolve_drive_oauth_token_path(
        data_dir=str(tmp_path),
        workspace_token_path=str(workspace),
        admin_token_paths=[str(admin)],
        environ={},
        auth_on=True,
    )
    assert resolved is None


def test_resolve_ignores_customer_workspace_when_auth_on(tmp_path):
    workspace = tmp_path / "tenants" / "cust" / "drive" / "oauth_token.json"
    _write_token(workspace, "customer@x.com")
    resolved = dc.resolve_drive_oauth_token_path(
        data_dir=str(tmp_path),
        workspace_token_path=str(workspace),
        admin_token_paths=[],
        environ={},
        auth_on=True,
    )
    assert resolved is None


def test_resolve_auth_off_uses_workspace_path(tmp_path):
    site = tmp_path / "auth" / "studio_oauth_token.json"
    workspace = tmp_path / "drive" / "oauth_token.json"
    _write_token(site, "studio@varimo.io")
    resolved = dc.resolve_drive_oauth_token_path(
        data_dir=str(tmp_path),
        workspace_token_path=str(workspace),
        admin_token_paths=[],
        environ={},
        auth_on=False,
    )
    assert resolved == str(workspace)


def test_not_configured_message_does_not_say_connect_google(monkeypatch):
    monkeypatch.delenv(dc.ENV_SA_JSON, raising=False)
    info = dc.resolve_drive_status(
        environ={
            dc.ENV_OAUTH_CLIENT_ID: "cid",
            dc.ENV_OAUTH_CLIENT_SECRET: "sec",
        },
    )
    assert info.status == "not_configured"
    assert "Connect Google" not in info.message
    assert "share" in info.message.lower()
    assert "studio" in info.message.lower()
