from tests.server.test_billing_api import _billing_client
from tests.server.test_auth_app import ADMIN, _password_login

SIGNUP = {"email": "Creator@example.com", "instagram": "@Creator", "monthly_variants": "100_500", "monthly_budget": "25_50", "use_case": "Testing reels", "consent": True}


def test_public_signup_persists_and_updates_without_duplicates(tmp_path):
    client, _, _ = _billing_client(tmp_path)
    assert client.post('/api/waitlist/creator', json=SIGNUP).status_code == 201
    assert client.post('/api/waitlist/creator', json={**SIGNUP, 'monthly_budget': '50_100'}).status_code == 201
    client, _, _ = _billing_client(tmp_path)
    assert client.get('/api/admin/creator-waitlist').status_code == 401
    assert client.get('/api/admin/creator-waitlist/export').status_code == 401
    _password_login(client, ADMIN, 'secret12')
    response = client.get('/api/admin/creator-waitlist')
    assert response.status_code == 200
    body = response.json()
    assert body['total'] == 1
    assert body['items'][0]['email'] == 'creator@example.com'
    assert body['items'][0]['instagram'] == 'creator'
    assert body['budgets'] == {'50_100': 1}
    assert body['usage'] == {'100_500': 1}


def test_validation_honeypot_and_csv(tmp_path):
    client, _, _ = _billing_client(tmp_path)
    for patch in [{'email': 'bad'}, {'instagram': 'https://instagram.com/me'}, {'consent': False}, {'monthly_budget': 'free'}]:
        assert client.post('/api/waitlist/creator', json={**SIGNUP, **patch}).status_code == 422
    missing = {k: v for k,v in SIGNUP.items() if k != 'consent'}
    assert client.post('/api/waitlist/creator', json=missing).status_code == 422
    assert client.post('/api/waitlist/creator', json={**SIGNUP, 'website': 'bot.example'}).status_code == 201
    _password_login(client, ADMIN, 'secret12')
    assert client.get('/api/admin/creator-waitlist').json()['total'] == 0
    assert client.post('/api/waitlist/creator', json={**SIGNUP, 'use_case': '=1+1'}).status_code == 201
    response = client.get('/api/admin/creator-waitlist/export')
    assert response.status_code == 200
    assert "'=1+1" in response.text
    assert response.headers['cache-control'] == 'no-store'


def test_non_admin_cannot_read_or_export(tmp_path):
    from fastapi.testclient import TestClient
    client, _, _ = _billing_client(tmp_path)
    _password_login(client, ADMIN, 'secret12')
    response = client.post('/api/auth/invites', json={'email':'reader@example.com', 'kind':'new_workspace'})
    assert response.status_code == 201
    reader = TestClient(client.app)
    assert _password_login(reader, 'reader@example.com', 'secret12').status_code == 200
    assert reader.get('/api/admin/creator-waitlist').status_code == 403
    assert reader.get('/api/admin/creator-waitlist/export').status_code == 403
