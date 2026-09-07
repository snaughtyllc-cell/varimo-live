"""Tenant JSON store + session cookie."""
from __future__ import annotations

import json
import os

from variant_maker.server.sessions import load_or_create_secret, read_session, sign_session
from variant_maker.server.tenants import (
    TenantStore,
    UserInfo,
    auth_required,
    is_admin_email,
    migrate_legacy_data,
    normalize_email,
    provision_login,
    tenant_root,
)


def test_normalize_and_auth_flag(monkeypatch):
    assert normalize_email("  Jeff@X.com ") == "jeff@x.com"
    monkeypatch.delenv("VARIANT_AUTH_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("SITE_ADMIN_EMAILS", raising=False)
    assert auth_required() is False
    monkeypatch.setenv("VARIANT_AUTH_ADMIN_EMAIL", "jeff@x.com")
    assert auth_required() is True


def test_is_admin_email_accepts_a_comma_list(monkeypatch):
    blob = "jeff@x.com, Partner@X.com"
    assert is_admin_email("JEFF@x.com", blob)
    assert is_admin_email("partner@x.com", blob)
    assert not is_admin_email("va@x.com", blob)
    assert not is_admin_email("jeff@x.com", None)
    monkeypatch.delenv("VARIANT_AUTH_ADMIN_EMAIL", raising=False)
    monkeypatch.setenv("SITE_ADMIN_EMAILS", "partner@x.com")
    assert auth_required() is True


def test_invite_join_and_consume(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    ws = store.create_workspace(name="Jeff")
    inv = store.add_invite(email="va@X.com", kind="join", workspace_id=ws.id)
    assert inv.email == "va@x.com"
    listed = store.list_invites()
    assert len(listed) == 1
    got = store.consume_invite("VA@x.com")
    assert got is not None and got.id == inv.id
    assert store.consume_invite("va@x.com") is None
    assert store.list_invites() == []


def test_join_invite_requires_workspace(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    try:
        store.add_invite(email="a@b.com", kind="join", workspace_id=None)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_upsert_user(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    ws = store.create_workspace(name="Ops")
    user = store.upsert_user(UserInfo(
        email="A@B.com", name="Ann", workspace_id=ws.id, role="owner",
    ))
    assert user.email == "a@b.com"
    again = store.get_user("a@b.com")
    assert again is not None and again.workspace_id == ws.id and again.role == "owner"


def test_upsert_user_preserves_password_hash(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    ws = store.create_workspace(name="Ops")
    store.upsert_user(UserInfo(
        email="a@b.com", name="Ann", workspace_id=ws.id, role="owner",
        password_hash="pbkdf2_sha256$1$abc$def",
    ))
    store.upsert_user(UserInfo(
        email="a@b.com", name="Ann B", workspace_id=ws.id, role="owner",
    ))
    again = store.get_user("a@b.com")
    assert again is not None
    assert again.name == "Ann B"
    assert again.password_hash == "pbkdf2_sha256$1$abc$def"
    listed = store.list_users()
    assert listed[0].password_hash == "pbkdf2_sha256$1$abc$def"


def test_delete_user_drops_login_and_pending_invite(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    ws = store.create_workspace(name="Jeff")
    store.upsert_user(UserInfo(
        email="va@x.com", name="VA", workspace_id=ws.id, role="member",
    ))
    store.add_invite(email="va@x.com", kind="join", workspace_id=ws.id)
    assert store.delete_user("VA@x.com") is True
    assert store.get_user("va@x.com") is None
    assert store.list_invites() == []
    assert store.delete_user("va@x.com") is False


def test_delete_invite(tmp_path):
    store = TenantStore(str(tmp_path / "tenants.json"))
    inv = store.add_invite(email="n@x.com", kind="new_workspace", workspace_id=None)
    assert store.delete_invite(inv.id) is True
    assert store.delete_invite(inv.id) is False


def test_session_roundtrip(tmp_path):
    secret = load_or_create_secret(str(tmp_path / "secret"))
    token = sign_session(email="a@b.com", workspace_id="ws_1", secret=secret, now=1_000)
    got = read_session(token, secret, now=1_001)
    assert got == {"email": "a@b.com", "workspace_id": "ws_1", "exp": 1_000 + 7 * 24 * 3600}


def test_session_rejects_tamper_and_expiry(tmp_path):
    secret = load_or_create_secret(str(tmp_path / "secret"))
    token = sign_session(email="a@b.com", workspace_id="ws_1", secret=secret, now=100, ttl_s=10)
    assert read_session(token + "x", secret, now=101) is None
    assert read_session(token, "other", now=101) is None
    assert read_session(token, secret, now=111) is None


def test_admin_view_cookie_roundtrip(tmp_path):
    from variant_maker.server.sessions import read_view, sign_view
    secret = load_or_create_secret(str(tmp_path / "secret"))
    token = sign_view("ws_other", secret, now=50, ttl_s=100)
    assert read_view(token, secret, now=51) == "ws_other"
    assert read_view(token, secret, now=200) is None
    sess = sign_session(email="a@b.com", workspace_id="ws_1", secret=secret, now=50)
    assert read_view(sess, secret, now=51) is None


def test_migrate_legacy_data_moves_jobs_once(tmp_path):
    root = tmp_path / "data"
    (root / "jobs" / "abc").mkdir(parents=True)
    (root / "jobs" / "abc" / "job.json").write_text("{}")
    (root / "drive").mkdir()
    (root / "drive" / "destinations.json").write_text("[]")
    assert migrate_legacy_data(str(root), "ws_admin") is True
    dest = tenant_root(str(root), "ws_admin")
    assert (os.path.join(dest, "jobs", "abc", "job.json"))
    assert os.path.isfile(os.path.join(dest, "jobs", "abc", "job.json"))
    assert os.path.isfile(os.path.join(dest, "drive", "destinations.json"))
    assert not os.path.isdir(os.path.join(str(root), "jobs"))
    assert migrate_legacy_data(str(root), "ws_admin") is False


def test_provision_admin_creates_workspace(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    user = provision_login(
        store, email="jeff@x.com", name="Jeff", admin_email="jeff@x.com",
        data_dir=str(tmp_path / "data"),
    )
    assert user is not None and user.role == "owner"
    assert store.get_workspace(user.workspace_id) is not None
    again = provision_login(
        store, email="jeff@x.com", name="Jeff", admin_email="jeff@x.com",
    )
    assert again is not None and again.workspace_id == user.workspace_id


def test_provision_uninvited_is_none(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    assert provision_login(
        store, email="stranger@x.com", name="S", admin_email="jeff@x.com",
    ) is None


def test_provision_join_invite(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    owner = provision_login(
        store, email="jeff@x.com", name="Jeff", admin_email="jeff@x.com",
    )
    assert owner is not None
    store.add_invite(email="va@x.com", kind="join", workspace_id=owner.workspace_id)
    va = provision_login(
        store, email="va@x.com", name="VA", admin_email="jeff@x.com",
    )
    assert va is not None
    assert va.workspace_id == owner.workspace_id
    assert va.role == "member"


def test_provision_new_workspace_invite(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    store.add_invite(email="ops@x.com", kind="new_workspace", workspace_id=None)
    ops = provision_login(
        store, email="ops@x.com", name="Ops", admin_email="jeff@x.com",
    )
    assert ops is not None and ops.role == "owner"
    ops_ws = store.get_workspace(ops.workspace_id)
    assert ops_ws is not None and ops_ws.experience == "solo"
    jeff = provision_login(
        store, email="jeff@x.com", name="Jeff", admin_email="jeff@x.com",
    )
    assert jeff is not None
    jeff_ws = store.get_workspace(jeff.workspace_id)
    assert jeff_ws is not None and jeff_ws.experience == "agency"
    assert ops.workspace_id != jeff.workspace_id


def test_new_studio_invite_is_creator_plan(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    store.add_invite(email="ops@x.com", kind="new_workspace", workspace_id=None)
    ops = provision_login(
        store, email="ops@x.com", name="Ops", admin_email="jeff@x.com",
    )
    assert ops is not None
    ws = store.get_workspace(ops.workspace_id)
    assert ws is not None
    assert ws.experience == "solo"
    assert ws.plan == "creator"


def test_missing_plan_key_is_internal(tmp_path):
    path = tmp_path / "t.json"
    path.write_text(json.dumps({
        "workspaces": {
            "ws_1": {"id": "ws_1", "name": "Jeff", "created_utc": "2026-08-20T00:00:00Z"},
        },
        "users": {},
        "invites": [],
    }))
    store = TenantStore(str(path))
    ws = store.get_workspace("ws_1")
    assert ws is not None and ws.plan == "internal"


def test_set_workspace_plan_sets_experience(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    ws = store.create_workspace(name="Ops", experience="solo", plan="creator")
    updated = store.set_workspace_plan(ws.id, "agency")
    assert updated is not None
    assert updated.plan == "agency"
    assert updated.experience == "agency"


def test_provision_join_solo_workspace_is_blocked(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    ws = store.create_workspace(name="Creator", experience="solo")
    store.upsert_user(UserInfo(
        email="creator@x.com", name="Creator", workspace_id=ws.id, role="owner",
    ))
    store.add_invite(email="va@x.com", kind="join", workspace_id=ws.id)
    va = provision_login(
        store, email="va@x.com", name="VA", admin_email="jeff@x.com",
    )
    assert va is None
    assert store.get_user("va@x.com") is None
    pending = store.list_invites()
    assert len(pending) == 1 and pending[0].email == "va@x.com"


def test_set_workspace_experience_defaults_agency(tmp_path):
    store = TenantStore(str(tmp_path / "t.json"))
    ws = store.create_workspace(name="Ops")
    assert ws.experience == "agency"
    updated = store.set_workspace_experience(ws.id, "solo")
    assert updated is not None and updated.experience == "solo"
    got = store.get_workspace(ws.id)
    assert got is not None and got.experience == "solo"


def test_missing_experience_key_is_agency(tmp_path):
    """Pre-experience tenants.json (Jeff Tingz live) must stay agency, not solo."""
    path = tmp_path / "t.json"
    path.write_text(json.dumps({
        "workspaces": {
            "ws_1": {"id": "ws_1", "name": "Jeff", "created_utc": "2026-08-20T00:00:00Z"},
        },
        "users": {},
        "invites": [],
    }))
    store = TenantStore(str(path))
    ws = store.get_workspace("ws_1")
    assert ws is not None and ws.experience == "agency"
