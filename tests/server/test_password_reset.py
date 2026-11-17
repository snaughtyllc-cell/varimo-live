import concurrent.futures
import hashlib

from fastapi.testclient import TestClient

from tests.server.test_auth_app import _auth_app
from variant_maker.server.passwords import hash_password, verify_password
from variant_maker.server.tenants import TenantStore


def setup_store(tmp_path):
    store = TenantStore(str(tmp_path / 'tenants.json'))
    ws = store.create_workspace(name='Camden')
    from variant_maker.server.tenants import UserInfo
    store.upsert_user(UserInfo('camden@example.com', 'Camden', ws.id, 'owner', hash_password('old-password')))
    return store


def test_reset_expiry_single_use_and_preserves_workspace(tmp_path):
    store = setup_store(tmp_path)
    before = store.get_user('camden@example.com')
    token = store.issue_password_reset(before.email, now=100, ttl_s=60)
    raw = (tmp_path / 'tenants.json').read_text()
    assert token not in raw
    assert hashlib.sha256(token.encode()).hexdigest() in raw
    assert store.consume_password_reset(token, hash_password('new-password'), now=161) is None
    token = store.issue_password_reset(before.email, now=200, ttl_s=60)
    assert store.consume_password_reset('invalid', hash_password('new-password'), now=201) is None
    after = store.consume_password_reset(token, hash_password('new-password'), now=201)
    assert after.workspace_id == before.workspace_id and after.role == before.role
    assert verify_password('new-password', after.password_hash)
    assert store.consume_password_reset(token, hash_password('other-password'), now=202) is None
    assert not store.session_is_current(before.email, 200)
    assert store.session_is_current(before.email, 202)


def test_reset_reissue_and_password_change_invalidates(tmp_path):
    store = setup_store(tmp_path)
    old = store.issue_password_reset('camden@example.com')
    new = store.issue_password_reset('camden@example.com')
    assert store.consume_password_reset(old, hash_password('something')) is None
    store.set_password('camden@example.com', hash_password('changed'))
    assert store.consume_password_reset(new, hash_password('something')) is None


def test_reset_concurrent_single_use(tmp_path):
    store = setup_store(tmp_path)
    token = store.issue_password_reset('camden@example.com')
    hashed = hash_password('something')
    with concurrent.futures.ThreadPoolExecutor() as pool:
        results = list(pool.map(lambda _: store.consume_password_reset(token, hashed), range(4)))
    assert sum(r is not None for r in results) == 1


def test_reset_public_form_and_api(tmp_path):
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    response = client.get('/api/auth/password/reset')
    assert response.status_code == 200
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert 'no-store' in response.headers['cache-control']
    assert 'location.hash' in response.text
    response = client.post('/api/auth/password/reset', json={'token': 'bad', 'password': 'long-password'})
    assert response.status_code == 400


def test_reset_api_success_revokes_only_target_sessions(tmp_path):
    from tests.server.test_auth_app import _login
    from variant_maker.server.sessions import COOKIE_NAME
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    _login(client, 'jeff')
    old_cookie = client.cookies.get(COOKIE_NAME)
    store = TenantStore(str(tmp_path / 'auth' / 'tenants.json'))
    from variant_maker.server.tenants import UserInfo
    other_workspace = store.create_workspace(name='Other')
    store.upsert_user(UserInfo('other@example.com', 'Other', other_workspace.id, 'owner', hash_password('other-password')))
    other = TestClient(app)
    assert other.post('/api/auth/password', json={'email':'other@example.com', 'password':'other-password'}).status_code == 200
    token = store.issue_password_reset('jeff@x.com')
    response = client.post('/api/auth/password/reset', json={'token': token, 'password': 'fresh-password'})
    assert response.status_code == 204, response.text
    assert client.get('/api/auth/me').json()['email'] is None
    assert other.get('/api/auth/me').json()['email'] == 'other@example.com'
    assert client.post('/api/auth/password', json={'email':'jeff@x.com', 'password':'fresh-password'}).status_code == 200
    assert client.get('/api/auth/me').json()['email'] == 'jeff@x.com'
    assert old_cookie != client.cookies.get(COOKIE_NAME)
    assert client.post('/api/auth/password/reset', json={'token':token, 'password':'other-password'}).status_code == 400


def test_reset_rejects_cross_origin_and_does_not_echo_secrets(tmp_path):
    app, _ = _auth_app(tmp_path)
    client = TestClient(app)
    assert client.post('/api/auth/password/reset', json={'token':'secret-token', 'password':'password'}, headers={'Origin':'https://evil.example'}).status_code == 403
    response = client.post('/api/auth/password/reset', json={'token':'secret-token', 'password':'short'})
    assert response.status_code == 400
    assert 'secret-token' not in response.text and 'short' not in response.text
    for _ in range(9):
        client.post('/api/auth/password/reset', json={'token':'bad', 'password':'long-password'})
    assert client.post('/api/auth/password/reset', json={'token':'bad', 'password':'long-password'}).status_code == 429


def test_reset_separate_store_instances_are_atomic(tmp_path):
    store = setup_store(tmp_path)
    token = store.issue_password_reset('camden@example.com')
    hashed = hash_password('something')
    def consume(_):
        return TenantStore(str(tmp_path / 'tenants.json')).consume_password_reset(token, hashed)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        results = list(pool.map(consume, range(4)))
    assert sum(r is not None for r in results) == 1


def test_password_login_racing_reset_cannot_keep_old_credential_session(tmp_path, monkeypatch):
    import threading

    import variant_maker.server.app as app_module
    from tests.server.test_auth_app import _login
    app, _ = _auth_app(tmp_path)
    seed = TestClient(app)
    _login(seed, 'jeff')
    seed.post('/api/auth/password/set', json={'password':'old-password'})
    store = TenantStore(str(tmp_path / 'auth' / 'tenants.json'))
    token = store.issue_password_reset('jeff@x.com')
    verified = threading.Event()
    continue_login = threading.Event()
    original = app_module.verify_password
    def paused_verify(password, stored):
        result = original(password, stored)
        verified.set()
        assert continue_login.wait(5)
        return result
    monkeypatch.setattr(app_module, 'verify_password', paused_verify)
    login_client = TestClient(app)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        login = pool.submit(login_client.post, '/api/auth/password', json={'email':'jeff@x.com', 'password':'old-password'})
        assert verified.wait(5)
        assert TestClient(app).post('/api/auth/password/reset', json={'token':token, 'password':'fresh-password'}).status_code == 204
        continue_login.set()
        assert login.result().status_code == 200
    # Cookie was issued AFTER reset, but based on the old verified hash.
    assert login_client.get('/api/auth/me').json()['email'] is None
    assert login_client.post('/api/auth/password', json={'email':'jeff@x.com', 'password':'fresh-password'}).status_code == 200
    assert login_client.get('/api/auth/me').json()['email'] == 'jeff@x.com'


def _process_consume(args):
    path, token, hashed = args
    return TenantStore(path).consume_password_reset(token, hashed) is not None


def test_reset_cross_process_atomic_consumption(tmp_path):
    store = setup_store(tmp_path)
    token = store.issue_password_reset('camden@example.com')
    args = (str(tmp_path / 'tenants.json'), token, hash_password('something'))
    with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(_process_consume, [args] * 3))
    assert sum(results) == 1
