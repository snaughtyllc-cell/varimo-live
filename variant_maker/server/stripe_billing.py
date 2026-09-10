"""Stripe Checkout + webhook verification. Tests inject a fake gateway."""
from __future__ import annotations

import secrets
import string
from collections.abc import Mapping
from typing import Any, Protocol

from variant_maker.server.billing import Plan
from variant_maker.server.tenants import normalize_email

RESTRICTED_KEY_ENV = "STRIPE_RESTRICTED_KEY"
SECRET_KEY_ENV = "STRIPE_SECRET_KEY"
WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET"
CHECKOUT_ORIGINS_ENV = "VARIANT_BILLING_CHECKOUT_ORIGINS"


class StripeGateway(Protocol):
    def create_checkout_session(self, params: dict[str, Any]) -> dict[str, Any]: ...
    def parse_webhook(self, payload: bytes, sig: str) -> dict[str, Any]: ...


def stripe_api_key(environ: Mapping[str, str]) -> str:
    return (environ.get(RESTRICTED_KEY_ENV) or environ.get(SECRET_KEY_ENV) or "").strip()


def webhook_secret(environ: Mapping[str, str]) -> str:
    return (environ.get(WEBHOOK_SECRET_ENV) or "").strip()


def checkout_origins(environ: Mapping[str, str]) -> list[str]:
    raw = environ.get(CHECKOUT_ORIGINS_ENV) or ""
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


def _integration_suffix() -> str:
    alphabet = string.ascii_lowercase
    return "".join(secrets.choice(alphabet) for _ in range(8))


def checkout_session_params(
    *,
    email: str,
    plan: Plan,
    price_id: str,
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    """Hosted Checkout for the Agency subscription. Dynamic payment methods — do not
    pass payment_method_types. automatic_tax stays off until a Stripe Tax registration
    is active (otherwise Stripe collects $0 tax while looking enabled).
    """
    addr = normalize_email(email)
    suffix = _integration_suffix()
    metadata = {"plan": plan.id}
    if addr:
        metadata["email"] = addr
    params: dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": metadata,
        "subscription_data": {"metadata": dict(metadata)},
        "integration_identifier": f"varyforge_{plan.id}_{suffix}",
    }
    # Without a prefill Stripe collects email; the paid webhook reads customer_details.email.
    if addr:
        params.update(customer_email=addr, client_reference_id=addr)
    return params


class LiveStripeGateway:
    def __init__(self, *, api_key: str, webhook_secret_value: str) -> None:
        from stripe import StripeClient, Webhook

        if not api_key:
            raise ValueError("missing Stripe API key")
        self._client = StripeClient(api_key)
        self._webhook_secret = webhook_secret_value
        self._Webhook = Webhook

    def create_checkout_session(self, params: dict[str, Any]) -> dict[str, Any]:
        session = self._client.v1.checkout.sessions.create(params)
        url = _obj_get(session, "url")
        sid = _obj_get(session, "id")
        if not url:
            raise RuntimeError("Stripe Checkout did not return a URL")
        return {"id": str(sid or ""), "url": str(url)}

    def parse_webhook(self, payload: bytes, sig: str) -> dict[str, Any]:
        if not self._webhook_secret:
            raise ValueError("missing STRIPE_WEBHOOK_SECRET")
        event = self._Webhook.construct_event(payload, sig, self._webhook_secret)
        if hasattr(event, "to_dict_recursive"):
            return event.to_dict_recursive()
        if hasattr(event, "to_dict"):
            return event.to_dict()
        return dict(event)


def _obj_get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def gateway_from_env(
    environ: Mapping[str, str],
    injected: StripeGateway | None = None,
) -> StripeGateway | None:
    if injected is not None:
        return injected
    key = stripe_api_key(environ)
    if not key:
        return None
    try:
        return LiveStripeGateway(api_key=key, webhook_secret_value=webhook_secret(environ))
    except ImportError:
        return None
