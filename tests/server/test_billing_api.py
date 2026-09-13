"""Stripe Checkout + webhook: pay → invite, no Jeff paste."""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from tests.server.test_auth_app import ADMIN, _password_login
from variant_maker.server.app import create_app
from variant_maker.server.billing import get_plan
from variant_maker.server.jobs import JobStore
from variant_maker.server.stripe_billing import checkout_session_params
from variant_maker.server.workspace import Workspace


class FakeStripeGateway:
    def __init__(self) -> None:
        self.sessions: list[dict] = []
        self.paid_sessions: dict[str, dict] = {}
        self.valid_sig = "t=1,v1=valid"

    def create_checkout_session(self, params: dict) -> dict:
        assert "payment_method_types" not in params
        assert "automatic_tax" not in params
        self.sessions.append(params)
        return {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"}

    def retrieve_checkout_session(self, session_id: str) -> dict:
        if session_id not in self.paid_sessions:
            raise KeyError(session_id)
        return self.paid_sessions[session_id]

    def parse_webhook(self, payload: bytes, sig: str) -> dict:
        if sig != self.valid_sig:
            raise ValueError("bad signature")
        return json.loads(payload.decode("utf-8"))


def _billing_client(tmp_path, *, gateway=None, extra_env=None):
    from variant_maker.server.drive_config import ENV_OAUTH_CLIENT_ID, ENV_OAUTH_CLIENT_SECRET
    from variant_maker.server.tenants import ADMIN_EMAIL_ENV

    env = {
        ADMIN_EMAIL_ENV: ADMIN,
        "VARIANT_AUTH_SECRET": "test-auth-secret",
        ENV_OAUTH_CLIENT_ID: "test-client-id",
        ENV_OAUTH_CLIENT_SECRET: "test-client-secret",
        "STRIPE_PRICE_AGENCY": "price_agency_test",
    }
    if extra_env:
        env.update(extra_env)
    gw = gateway if gateway is not None else FakeStripeGateway()
    app = create_app(
        JobStore(Workspace(str(tmp_path)), FakeRunner({})),
        hydrate=False,
        auth_environ=env,
        oauth_environ=env,
        sa_json_path="",
        stripe_gateway=gw,
        billing_environ=env,
    )
    return TestClient(app), gw, env


def test_checkout_params_omit_payment_method_types_and_tax():
    plan = get_plan("agency")
    params = checkout_session_params(
        email="Ops@X.com",
        plan=plan,
        price_id="price_1",
        success_url="https://studio.test/login?paid=1",
        cancel_url="https://studio.test/pricing",
    )
    assert "payment_method_types" not in params
    assert "automatic_tax" not in params
    assert params["mode"] == "subscription"
    assert params["customer_email"] == "ops@x.com"
    assert params["metadata"]["plan"] == "agency"
    assert params["integration_identifier"].startswith("varyforge_agency_")
    assert params["line_items"] == [{"price": "price_1", "quantity": 1}]


def test_plans_are_public_and_checkout_starts_session(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    plans = client.get("/api/billing/plans")
    assert plans.status_code == 200
    body = plans.json()
    assert body["configured"] is True
    assert body["plans"][0]["id"] == "agency"
    assert body["plans"][0]["included_fast_hours"] == 90
    assert body["plans"][0]["overage_usd_per_hour"] == 0.75
    assert body["plans"][0]["typical_fast20_minutes"] == 10
    assert body["plans"][0]["typical_fast20_packs"] == 540
    assert body["plans"][0]["typical_fast20_copies"] == 10800
    assert "cogs_fast_usd_per_hour" not in body["plans"][0]
    resp = client.post("/api/billing/checkout", json={"email": "buyer@x.com", "plan": "agency"})
    assert resp.status_code == 200
    assert resp.json()["url"].startswith("https://checkout.stripe.com/")
    assert gw.sessions[0]["customer_email"] == "buyer@x.com"
    assert "payment_method_types" not in gw.sessions[0]


def test_checkout_is_public_when_auth_is_on(tmp_path):
    client, _gw, _env = _billing_client(tmp_path)
    # No session cookie — still 200, not 401.
    resp = client.post("/api/billing/checkout", json={"email": "buyer@x.com"})
    assert resp.status_code == 200


def test_webhook_without_signature_does_not_invite(tmp_path):
    client, _gw, _env = _billing_client(tmp_path)
    event = {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_1", "payment_status": "paid",
            "customer_email": "buyer@x.com", "metadata": {"plan": "agency"},
        }},
    }
    resp = client.post(
        "/api/billing/webhook",
        content=json.dumps(event),
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 400
    denied = _password_login(client, "buyer@x.com", "secret12")
    assert denied.status_code == 401


def test_paid_webhook_lets_them_set_a_password_without_jeff(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    event = {
        "type": "checkout.session.completed",
        "data": {"object": {
            "id": "cs_1",
            "payment_status": "paid",
            "customer": "cus_1",
            "subscription": "sub_1",
            "customer_details": {"email": "buyer@x.com"},
            "metadata": {"plan": "agency"},
        }},
    }
    resp = client.post(
        "/api/billing/webhook",
        content=json.dumps(event),
        headers={"stripe-signature": gw.valid_sig, "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["action"] == "invited"
    first = _password_login(client, "buyer@x.com", "secret12")
    assert first.status_code == 200
    assert first.json()["email"] == "buyer@x.com"
    assert first.json()["role"] == "owner"
    status = client.get("/api/billing/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["status"] == "active"
    assert payload["unlimited"] is False
    assert payload["plan"]["id"] == "agency"
    assert payload["usage"]["tone"] == "included"
    assert payload["usage"]["remaining_pct"] == 100
    assert payload["usage"]["meter_line"] == "90 of 90h left"
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["usage"]["meter_line"] == "90 of 90h left"
    assert me.json()["usage"]["uncapped"] is False
    assert me.json()["usage"]["tone"] == "included"


def test_checkout_503_when_price_missing(tmp_path):
    client, _gw, _env = _billing_client(tmp_path, extra_env={"STRIPE_PRICE_AGENCY": ""})
    resp = client.post("/api/billing/checkout", json={"email": "buyer@x.com"})
    assert resp.status_code == 503


def test_checkout_without_email_lets_stripe_collect_it(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    resp = client.post("/api/billing/checkout", json={"plan": "agency"})
    assert resp.status_code == 200
    params = gw.sessions[0]
    assert "customer_email" not in params
    assert "client_reference_id" not in params
    assert params["metadata"] == {"plan": "agency"}
    assert params["subscription_data"]["metadata"] == {"plan": "agency"}
    assert params["cancel_url"].endswith("/#pricing")
    assert "paid=1&session_id={CHECKOUT_SESSION_ID}" in params["success_url"]
    # The signed webhook provides the email collected by Stripe; no prefilled metadata needed.
    event = {"type": "checkout.session.completed", "data": {"object": {
        "id": "cs_test_1", "payment_status": "paid", "customer": "cus_direct",
        "subscription": "sub_direct", "customer_details": {"email": "direct@x.com"},
        "metadata": params["metadata"],
    }}}
    webhook = client.post("/api/billing/webhook", content=json.dumps(event),
                          headers={"stripe-signature": gw.valid_sig})
    assert webhook.status_code == 200
    assert _password_login(client, "direct@x.com", "secret12").status_code == 200


def test_checkout_rejects_invalid_optional_email(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    resp = client.post("/api/billing/checkout", json={"email": "invalid"})
    assert resp.status_code == 400
    assert gw.sessions == []


def test_return_from_stripe_sets_password_before_webhook(tmp_path):
    """Stripe success lands before the webhook. session_id must still open Studio."""
    client, gw, _env = _billing_client(tmp_path)
    gw.paid_sessions["cs_test_return"] = {
        "id": "cs_test_return",
        "payment_status": "paid",
        "customer": "cus_return",
        "subscription": "sub_return",
        "customer_details": {"email": "newagency@x.com"},
        "metadata": {"plan": "agency"},
    }
    peek = client.get("/api/billing/checkout-session", params={"session_id": "cs_test_return"})
    assert peek.status_code == 200
    assert peek.json() == {"paid": True, "email": "newagency@x.com"}
    first = _password_login(
        client, "newagency@x.com", "agency-pass", session_id="cs_test_return",
    )
    assert first.status_code == 200
    body = first.json()
    assert body["email"] == "newagency@x.com"
    assert body["role"] == "owner"
    assert body["experience"] == "agency"
    assert body["plan"] == "agency"
    assert body["has_password"] is True
    again = _password_login(client, "newagency@x.com", "agency-pass")
    assert again.status_code == 200


def test_unpaid_checkout_session_cannot_create_a_login(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    gw.paid_sessions["cs_unpaid"] = {
        "id": "cs_unpaid",
        "payment_status": "unpaid",
        "customer_details": {"email": "nope@x.com"},
    }
    peek = client.get("/api/billing/checkout-session", params={"session_id": "cs_unpaid"})
    assert peek.json()["paid"] is False
    denied = _password_login(client, "nope@x.com", "secret12", session_id="cs_unpaid")
    assert denied.status_code == 401


def test_checkout_session_email_must_match_login(tmp_path):
    client, gw, _env = _billing_client(tmp_path)
    gw.paid_sessions["cs_paid"] = {
        "id": "cs_paid",
        "payment_status": "paid",
        "customer_details": {"email": "buyer@x.com"},
        "metadata": {"plan": "agency"},
    }
    mismatch = _password_login(client, "other@x.com", "secret12", session_id="cs_paid")
    assert mismatch.status_code == 400
