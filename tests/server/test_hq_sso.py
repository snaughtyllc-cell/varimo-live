"""HQ SSO: existing Varimo accounts only, no token in logs or responses."""
from __future__ import annotations

import json
import logging
import time
import uuid

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from tests.server.test_auth_app import ADMIN, _auth_app, _login
from variant_maker.server.app import create_app
from variant_maker.server.auth_app import PUBLIC_API_PATHS
from variant_maker.server.hq_sso import (
    CLOCK_SKEW_S,
    SSO_SECRET_ENV,
    HqSsoError,
    JtiStore,
    parse_token_body,
    read_sso_secret,
    sign_hq_token,
    sso_failure,
    verify_hq_token,
)
from variant_maker.server.jobs import JobStore
from variant_maker.server.sessions import COOKIE_NAME, VIEW_COOKIE_NAME
from variant_maker.server.workspace import Workspace

SSO_SECRET = "hq-sso-test-secret-value-32b-min"


def _claims(email: str, *, now: float | None = None, **overrides: object) -> dict:
    ts = time.time() if now is None else now
    body: dict = {
        "iss": "hq",
        "aud": "varimo",
        "sub": "mem_hq_1",
        "email": email,
        "name": "From HQ",
        "role": "va",
        "iat": int(ts),
        "exp": int(ts) + 60,
        "jti": uuid.uuid4().hex,
    }
    body.update(overrides)
    return body


def _token(email: str = ADMIN, **overrides: object) -> str:
    return sign_hq_token(_claims(email, **overrides), SSO_SECRET)


def _app(tmp_path, *, secret: str | None = SSO_SECRET, auth: bool = True):
    extra = {SSO_SECRET_ENV: secret} if secret is not None else {}
    if not auth:
        ws = Workspace(str(tmp_path))
        store = JobStore(ws, FakeRunner({}))
        env = {SSO_SECRET_ENV: secret or SSO_SECRET}
        return create_app(store, hydrate=False, auth_environ=env, oauth_environ=env, sa_json_path="")
    return _auth_app(tmp_path, extra_env=extra)[0]


def _provision_admin(client: TestClient) -> None:
    created = client.post(
        "/api/auth/password",
        json={"email": ADMIN, "password": "correct-horse"},
    )
    assert created.status_code == 200, created.text
    assert client.post("/api/auth/logout").status_code == 204


def test_sso_path_is_public_and_secret_name_is_stable():
    assert "/api/auth/hq" in PUBLIC_API_PATHS
    assert SSO_SECRET_ENV == "VARIMO_SSO_SECRET"
    assert read_sso_secret({}) is None
    assert read_sso_secret({SSO_SECRET_ENV: "short"}) is None
    assert read_sso_secret({SSO_SECRET_ENV: "  " + SSO_SECRET + "\n"}) == SSO_SECRET


def test_unknown_email_copy_and_disabled_status():
    assert sso_failure("unknown_email") == (
        403, "This email isn't invited. Ask the operator to add you.",
    )
    assert sso_failure("disabled")[0] == 404
    assert sso_failure("expired")[0] == 401
    assert sso_failure("replay")[0] == 401


def test_verify_accepts_skew_and_rejects_bad_tokens():
    now = 1_700_000_000.0
    ok = verify_hq_token(_token(now=now), SSO_SECRET, now=now)
    assert ok["email"] == ADMIN
    assert ok["role"] == "va"

    within = _claims(ADMIN, now=now - 20, iat=int(now - 80), exp=int(now - 20))
    verify_hq_token(sign_hq_token(within, SSO_SECRET), SSO_SECRET, now=now)

    future = _claims(ADMIN, now=now + 20, iat=int(now + 20), exp=int(now + 80))
    verify_hq_token(sign_hq_token(future, SSO_SECRET), SSO_SECRET, now=now)

    expired = _claims(ADMIN, iat=int(now - 200), exp=int(now - CLOCK_SKEW_S - 1))
    try:
        verify_hq_token(sign_hq_token(expired, SSO_SECRET), SSO_SECRET, now=now)
    except HqSsoError as exc:
        assert exc.code == "expired"
    else:
        raise AssertionError("expired token was accepted")

    too_new = _claims(ADMIN, iat=int(now + CLOCK_SKEW_S + 5), exp=int(now + CLOCK_SKEW_S + 65))
    _reject(sign_hq_token(too_new, SSO_SECRET), now)

    for bad in (
        _claims(ADMIN, aud="hq", now=now),
        _claims(ADMIN, iss="varimo", now=now),
        _claims(ADMIN, iat=int(now), exp=int(now) + 120, now=now),
        _claims(ADMIN, role="owner", now=now),
        _claims("not-an-email", now=now),
    ):
        _reject(sign_hq_token(bad, SSO_SECRET), now)

    signed = _token(now=now)
    flipped = signed[:-1] + ("a" if signed[-1] != "a" else "b")
    _reject(flipped, now)
    _reject(_unsigned(_claims(ADMIN, now=now)), now)

    other = sign_hq_token(_claims(ADMIN, now=now), "z" * 32)
    _reject(other, now)

    upper = verify_hq_token(_token("Jeff@X.com", now=now), SSO_SECRET, now=now)
    assert upper["email"] == "jeff@x.com"


def test_hmac_key_is_the_env_string_not_base64_decoded():
    import base64
    secret = base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")
    now = 1_700_000_000.0
    token = sign_hq_token(_claims(ADMIN, now=now), secret)
    assert verify_hq_token(token, secret, now=now)["email"] == ADMIN
    decoded = base64.urlsafe_b64decode(secret + "==")
    try:
        verify_hq_token(token, decoded.decode("ascii"), now=now)
    except HqSsoError as exc:
        assert exc.code == "invalid"
    else:
        raise AssertionError("decoded key was accepted")


def test_jti_store_rejects_replay_until_exp_and_fails_closed(tmp_path):
    path = tmp_path / "jti.json"
    store = JtiStore(str(path))
    assert store.consume("abc12345", 100.0, now=80.0) is True
    assert store.consume("abc12345", 100.0, now=90.0) is False
    assert store.consume("abc12345", 100.0, now=131.0) is True
    path.write_text("{", encoding="utf-8")
    try:
        JtiStore(str(path)).consume("zzzzzzzz", 10.0, now=1.0)
    except HqSsoError as exc:
        assert exc.code == "unavailable"
    else:
        raise AssertionError("corrupt jti file was accepted")


def test_parse_body_does_not_echo_the_token():
    token = _token()
    assert parse_token_body(json.dumps({"token": token}).encode()) == token
    for raw in (b"", b"[]", b"null", json.dumps({"token": ""}).encode()):
        try:
            parse_token_body(raw)
        except HqSsoError as exc:
            assert exc.code == "invalid"
            assert token not in str(exc)
        else:
            raise AssertionError(raw)


def _reject(token: str, now: float) -> None:
    try:
        verify_hq_token(token, SSO_SECRET, now=now)
    except HqSsoError as exc:
        assert exc.code == "invalid"
        assert token not in str(exc)
    else:
        raise AssertionError("bad token was accepted")


def _unsigned(payload: dict) -> str:
    import base64
    def seg(obj: dict) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    return seg({"alg": "none", "typ": "JWT"}) + "." + seg(payload) + "."


def test_disabled_without_secret_or_auth(tmp_path):
    off = TestClient(_app(tmp_path, secret=None))
    hidden = _token()
    missing = off.post("/api/auth/hq", json={"token": hidden})
    assert missing.status_code == 404
    assert hidden not in missing.text

    short = TestClient(_app(tmp_path / "short", secret="too-short"))
    assert short.post("/api/auth/hq", json={"token": _token()}).status_code == 404

    no_auth = TestClient(_app(tmp_path / "off", secret=SSO_SECRET, auth=False))
    disabled = no_auth.post("/api/auth/hq", json={"token": _token()})
    assert disabled.status_code == 404


def test_valid_token_logs_in_without_changing_the_account_or_logging_the_token(
    tmp_path, capsys, caplog,
):
    app = _app(tmp_path)
    client = TestClient(app)
    _provision_admin(client)
    before = app.state.tenants.get_user(ADMIN)
    token = _token(name="Someone Else", role="admin", workspace_id="ws_attacker")
    with caplog.at_level(logging.DEBUG):
        resp = client.post("/api/auth/hq", json={"token": token})
    captured = capsys.readouterr()
    blob = captured.out + captured.err + caplog.text
    assert token not in blob
    assert token not in resp.text
    assert resp.status_code == 204
    assert resp.content == b""
    assert SSO_SECRET not in blob
    me = client.get("/api/auth/me").json()
    assert me["email"] == ADMIN
    assert me["name"] == before.name
    assert me["role"] == "owner"
    assert me["is_admin"] is True
    assert me["workspace_id"] == before.workspace_id
    assert me["viewing_other"] is False
    assert client.cookies.get(COOKIE_NAME)
    stored = (tmp_path / "auth" / "hq_sso_jti.json").read_text(encoding="utf-8")
    assert token not in stored


def test_bad_signature_aud_iss_expired_and_replay_are_rejected(tmp_path, capsys, caplog):
    app = _app(tmp_path)
    client = TestClient(app)
    _provision_admin(client)
    now = time.time()
    cases = {
        "signature": _token()[:-1] + ("a" if _token()[-1] != "a" else "b"),
        "aud": sign_hq_token(_claims(ADMIN, aud="other"), SSO_SECRET),
        "iss": sign_hq_token(_claims(ADMIN, iss="other"), SSO_SECRET),
        "expired": sign_hq_token(
            _claims(ADMIN, iat=int(now - 300), exp=int(now - 120)), SSO_SECRET,
        ),
    }
    # The signature case built two different tokens. Rebuild one mutated token.
    signed = _token()
    cases["signature"] = signed[:-1] + ("a" if signed[-1] != "a" else "b")
    with caplog.at_level(logging.DEBUG):
        for name, token in cases.items():
            resp = client.post("/api/auth/hq", json={"token": token})
            assert token not in resp.text
            if name == "expired":
                assert resp.status_code == 401
                assert "expired" in resp.json()["detail"].lower()
            else:
                assert resp.status_code == 401, name
                assert resp.json()["detail"] == "Sign-in link is not valid."
            assert client.get("/api/auth/me").json()["email"] is None
        replay = _token()
        first = client.post("/api/auth/hq", json={"token": replay})
        assert first.status_code == 204
        again = client.post("/api/auth/hq", json={"token": replay})
        assert again.status_code == 401
        assert "already used" in again.json()["detail"]
        assert replay not in again.text
    captured = capsys.readouterr()
    blob = captured.out + captured.err + caplog.text
    for token in list(cases.values()) + [replay]:
        assert token not in blob


def test_unknown_email_is_403_and_does_not_provision_or_burn_the_link(tmp_path):
    app = _app(tmp_path)
    client = TestClient(app)
    token = _token(ADMIN)
    denied = client.post("/api/auth/hq", json={"token": token})
    assert denied.status_code == 403
    assert denied.json()["detail"] == "This email isn't invited. Ask the operator to add you."
    assert token not in denied.text
    assert app.state.tenants.get_user(ADMIN) is None
    assert client.get("/api/auth/me").json()["email"] is None

    _provision_admin(client)
    accepted = client.post("/api/auth/hq", json={"token": token})
    assert accepted.status_code == 204
    assert client.get("/api/auth/me").json()["email"] == ADMIN

    invited = client.post(
        "/api/auth/invites", json={"email": "stranger@x.com", "kind": "new_workspace"},
    )
    assert invited.status_code == 201
    pending = _token("stranger@x.com")
    anon = TestClient(app)
    still = anon.post("/api/auth/hq", json={"token": pending})
    assert still.status_code == 403
    assert pending not in still.text
    assert app.state.tenants.get_user("stranger@x.com") is None
    assert any(i.email == "stranger@x.com" for i in app.state.tenants.list_invites())


def test_sso_lands_in_the_existing_home_workspace_and_clears_admin_view(tmp_path):
    app = _app(tmp_path)
    jeff = TestClient(app)
    ops = TestClient(app)
    va = TestClient(app)
    _login(jeff, "jeff")
    jeff.post("/api/auth/invites", json={"email": "ops@x.com", "kind": "new_workspace"})
    jeff.post("/api/auth/invites", json={"email": "va@x.com", "kind": "join"})
    _login(ops, "ops")
    _login(va, "va")
    home = jeff.get("/api/auth/me").json()["home_workspace_id"]
    ops_id = ops.get("/api/auth/me").json()["workspace_id"]
    assert ops_id != home
    assert va.get("/api/auth/me").json()["workspace_id"] == home
    assert va.get("/api/auth/me").json()["role"] == "member"

    switched = jeff.post("/api/admin/view", json={"workspace_id": ops_id})
    assert switched.status_code == 204
    assert jeff.get("/api/auth/me").json()["viewing_other"] is True

    entered = jeff.post("/api/auth/hq", json={"token": _token(ADMIN, role="va")})
    assert entered.status_code == 204
    me = jeff.get("/api/auth/me").json()
    assert me["workspace_id"] == home
    assert me["home_workspace_id"] == home
    assert me["viewing_other"] is False
    assert me["is_admin"] is True
    assert not jeff.cookies.get(VIEW_COOKIE_NAME)

    va_token = _token("VA@x.com", role="admin", name="Not VA")
    va_resp = va.post("/api/auth/hq", json={"token": va_token})
    assert va_resp.status_code == 204
    va_me = va.get("/api/auth/me").json()
    assert va_me["email"] == "va@x.com"
    assert va_me["name"] == "VA"
    assert va_me["role"] == "member"
    assert va_me["is_admin"] is False
    assert va_me["workspace_id"] == home


def test_password_login_still_works_when_sso_is_configured(tmp_path):
    app = _app(tmp_path)
    client = TestClient(app)
    resp = client.post(
        "/api/auth/password",
        json={"email": ADMIN, "password": "correct-horse"},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == ADMIN
