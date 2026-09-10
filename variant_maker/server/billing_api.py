"""HTTP routes for public Checkout, Stripe webhooks, and signed-in usage."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

from variant_maker.server.billing import (
    AGENCY_PLAN_ID,
    apply_stripe_event,
    billing_status_payload,
    get_plan,
    plan_catalog,
    plan_public_dict,
    stripe_price_id,
)
from variant_maker.server.stripe_billing import (
    StripeGateway,
    checkout_origins,
    checkout_session_params,
)
from variant_maker.server.tenants import TenantStore, normalize_email


class CheckoutIn(BaseModel):
    email: str = ""
    plan: str = AGENCY_PLAN_ID


class CheckoutOut(BaseModel):
    url: str
    session_id: str


def _email_ok(email: str) -> bool:
    addr = normalize_email(email)
    return bool(addr) and "@" in addr and "." in addr.split("@")[-1]


def register_billing_routes(
    app: FastAPI,
    *,
    tenants: TenantStore | None,
    auth_on: bool,
    store: Any,
    billing_env: Mapping[str, str],
    gateway: StripeGateway | None,
    studio_origin: Callable[[Request], str],
    require_user: Callable[[Request], Any],
    admin_email: str | None,
    is_admin: Callable[[str, str | None], bool],
) -> None:
    origins = checkout_origins(billing_env)
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type"],
        )

    @app.get("/api/billing/plans")
    def billing_plans() -> dict[str, Any]:
        price = stripe_price_id(get_plan(AGENCY_PLAN_ID, billing_env), billing_env)
        configured = bool(auth_on and tenants is not None and gateway is not None and price)
        return {
            "configured": configured,
            "plans": [plan_public_dict(p) for p in plan_catalog(billing_env)],
        }

    @app.post("/api/billing/checkout", response_model=CheckoutOut)
    def billing_checkout(request: Request, body: CheckoutIn) -> CheckoutOut:
        if not auth_on or tenants is None:
            raise HTTPException(status_code=503, detail="Studio login is off — billing needs VARIANT_AUTH_ADMIN_EMAIL.")
        if gateway is None:
            raise HTTPException(
                status_code=503,
                detail="Billing isn't connected. Set STRIPE_RESTRICTED_KEY (or STRIPE_SECRET_KEY) and STRIPE_PRICE_AGENCY.",
            )
        email = normalize_email(body.email)
        if email and not _email_ok(email):
            raise HTTPException(status_code=400, detail="email is invalid")
        try:
            plan = get_plan(body.plan, billing_env)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        price_id = stripe_price_id(plan, billing_env)
        if not price_id:
            raise HTTPException(
                status_code=503,
                detail=f"Set {plan.stripe_price_env} to the Stripe Price id for {plan.name}.",
            )
        origin = studio_origin(request).rstrip("/")
        email_query = f"&email={quote(email, safe='')}" if email else ""
        success = f"{origin}/login?paid=1{email_query}&session_id={{CHECKOUT_SESSION_ID}}"
        cancel = f"{origin}/landing#pricing"
        params = checkout_session_params(
            email=email,
            plan=plan,
            price_id=price_id,
            success_url=success,
            cancel_url=cancel,
        )
        try:
            session = gateway.create_checkout_session(params)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Stripe Checkout failed.") from exc
        url = str(session.get("url") or "")
        if not url:
            raise HTTPException(status_code=502, detail="Stripe Checkout failed.")
        return CheckoutOut(url=url, session_id=str(session.get("id") or ""))

    @app.post("/api/billing/webhook")
    async def billing_webhook(request: Request) -> JSONResponse:
        if not auth_on or tenants is None:
            raise HTTPException(status_code=503, detail="auth is off")
        if gateway is None:
            raise HTTPException(status_code=503, detail="billing isn't connected")
        payload = await request.body()
        sig = request.headers.get("stripe-signature") or ""
        try:
            event = gateway.parse_webhook(payload, sig)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid signature") from exc
        if not isinstance(event, dict):
            raise HTTPException(status_code=400, detail="invalid event")
        action = apply_stripe_event(tenants, event)
        return JSONResponse({"received": True, "action": action})

    @app.get("/api/billing/status")
    def billing_status(request: Request) -> dict[str, Any]:
        user = require_user(request)
        assert tenants is not None
        rec = tenants.get_billing(user.email)
        if rec is None:
            rec = tenants.get_billing_for_workspace(user.workspace_id)
        ws = getattr(store, "_ws", None)
        jobs = list(getattr(store, "_jobs", {}).values())
        return billing_status_payload(
            rec=rec,
            workspace=ws,
            is_admin=is_admin(user.email, admin_email),
            environ=billing_env,
            jobs=jobs,
        )
