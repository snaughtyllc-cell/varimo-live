"""Paid plans, Fast overage math, and grant-after-payment.

Stripe stays out of this module so sampler-style tests can run without the SDK.
Checkout + webhook live in stripe_billing.py.
"""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from variant_maker.server.tenants import (
    BillingRecord,
    TenantStore,
    normalize_email,
)

# Internal Fast COGS. Do not put this number on the marketing site.
FAST_USD_PER_HOUR = 0.58

AGENCY_PLAN_ID = "agency"
AGENCY_PRICE_USD = 200
AGENCY_INCLUDED_FAST_HOURS = 90
AGENCY_OVERAGE_USD_PER_HOUR = 0.75
AGENCY_PRICE_ENV = "STRIPE_PRICE_AGENCY"
AGENCY_FAST_HOURS_ENV = "VARIANT_PLAN_AGENCY_FAST_HOURS"
AGENCY_OVERAGE_ENV = "VARIANT_PLAN_AGENCY_OVERAGE_USD"
PERIOD_DAYS = 30
# Warm-worker talking-head Fast 20 — billed Fast time, not a SLA.
TYPICAL_FAST20_MINUTES = 10.0
TYPICAL_FAST20_COPIES_PER_PACK = 20

ACTIVE_STATUSES = frozenset({"active", "trialing"})
KNOWN_PLANS = frozenset({AGENCY_PLAN_ID})


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    price_usd: int
    included_fast_hours: float
    overage_usd_per_hour: float
    cogs_fast_usd_per_hour: float
    stripe_price_env: str


@dataclass(frozen=True)
class OverageSnapshot:
    plan_id: str
    fast_seconds: float
    included_fast_seconds: float
    overage_fast_seconds: float
    overage_usd: float
    remaining_fast_seconds: float


def _float_env(env: Mapping[str, str], key: str, default: float) -> float:
    raw = (env.get(key) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def get_plan(plan_id: str | None = AGENCY_PLAN_ID, environ: Mapping[str, str] | None = None) -> Plan:
    env = os.environ if environ is None else environ
    kind = (plan_id or AGENCY_PLAN_ID).strip().lower() or AGENCY_PLAN_ID
    if kind not in KNOWN_PLANS:
        raise ValueError("unknown plan")
    hours = _float_env(env, AGENCY_FAST_HOURS_ENV, AGENCY_INCLUDED_FAST_HOURS)
    overage = _float_env(env, AGENCY_OVERAGE_ENV, AGENCY_OVERAGE_USD_PER_HOUR)
    return Plan(
        id=AGENCY_PLAN_ID,
        name="Agency",
        price_usd=AGENCY_PRICE_USD,
        included_fast_hours=max(0.0, hours),
        overage_usd_per_hour=max(0.0, overage),
        cogs_fast_usd_per_hour=FAST_USD_PER_HOUR,
        stripe_price_env=AGENCY_PRICE_ENV,
    )


def plan_catalog(environ: Mapping[str, str] | None = None) -> list[Plan]:
    return [get_plan(AGENCY_PLAN_ID, environ)]


def stripe_price_id(plan: Plan, environ: Mapping[str, str] | None = None) -> str:
    env = os.environ if environ is None else environ
    return (env.get(plan.stripe_price_env) or "").strip()


def period_fast_seconds(workspace: Any, *, start: datetime | None = None, end: datetime | None = None) -> float:
    """Fast worker-seconds in [start, end). Live copy-ledger rows without Fast
    telemetry count as 0 — overage stays recorded, Generate is not blocked.
    """
    path = getattr(workspace, "usage_path", None)
    path = path() if callable(path) else path
    if not path or not os.path.isfile(path):
        return 0.0
    when_end = end or datetime.now(UTC)
    if when_end.tzinfo is None:
        when_end = when_end.replace(tzinfo=UTC)
    when_end = when_end.astimezone(UTC)
    if start is None:
        when_start = when_end - timedelta(days=30)
    elif start.tzinfo is None:
        when_start = start.replace(tzinfo=UTC)
    else:
        when_start = start.astimezone(UTC)
    total = 0.0
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return 0.0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        if str(row.get("quality_mode") or "").strip().lower() != "fast":
            continue
        ts = _parse_utc(str(row.get("utc") or row.get("completed_utc") or ""))
        if ts is None or ts < when_start or ts >= when_end:
            continue
        billed = row.get("billed")
        if isinstance(billed, dict) and billed.get("real_work_s") is not None:
            try:
                total += max(0.0, float(billed["real_work_s"]))
                continue
            except (TypeError, ValueError):
                pass
        submitted = _parse_utc(str(row.get("submitted_utc") or ""))
        finished = _parse_utc(str(row.get("completed_utc") or row.get("utc") or ""))
        if submitted is None or finished is None:
            continue
        total += max(0.0, (finished - submitted).total_seconds())
    return total


def typical_fast20_throughput(included_fast_hours: float) -> tuple[int, int]:
    """Typical talking-head Fast-20 packs / copies for an included-hour block.

    Uses ~10 minutes of Fast time per 20-pack (warm worker, short talking-head).
    90 hours → 540 packs / 10,800 copies. Heavier clips and cold start take
    longer — typical, not a promise.
    """
    hours = max(0.0, float(included_fast_hours or 0.0))
    raw_packs = (hours * 60.0) / TYPICAL_FAST20_MINUTES if TYPICAL_FAST20_MINUTES else 0.0
    packs = round(raw_packs) if raw_packs else 0
    return packs, packs * TYPICAL_FAST20_COPIES_PER_PACK


def overage_snapshot(plan: Plan, fast_seconds: float) -> OverageSnapshot:
    used = max(0.0, float(fast_seconds or 0.0))
    included = max(0.0, float(plan.included_fast_hours) * 3600.0)
    overage_s = max(0.0, used - included)
    remaining = max(0.0, included - used)
    overage_usd = round((overage_s / 3600.0) * float(plan.overage_usd_per_hour), 6)
    return OverageSnapshot(
        plan_id=plan.id,
        fast_seconds=used,
        included_fast_seconds=included,
        overage_fast_seconds=overage_s,
        overage_usd=overage_usd,
        remaining_fast_seconds=remaining,
    )


def _parse_utc(value: str | None) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_from_unix(ts: Any) -> str | None:
    try:
        n = int(ts)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return datetime.fromtimestamp(n, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def period_end_from_start(start_utc: str | None, *, days: int = PERIOD_DAYS) -> str:
    start = _parse_utc(start_utc) or datetime.now(UTC)
    return (start + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def session_email(session: Mapping[str, Any]) -> str:
    details = session.get("customer_details") if isinstance(session.get("customer_details"), dict) else {}
    meta = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
    return normalize_email(
        str(
            session.get("customer_email")
            or details.get("email")
            or meta.get("email")
            or session.get("client_reference_id")
            or ""
        )
    )


def session_plan(session: Mapping[str, Any]) -> str:
    meta = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
    sub_meta = {}
    sub = session.get("subscription_details")
    if isinstance(sub, dict) and isinstance(sub.get("metadata"), dict):
        sub_meta = sub["metadata"]
    kind = str(meta.get("plan") or sub_meta.get("plan") or AGENCY_PLAN_ID).strip().lower()
    return kind if kind in KNOWN_PLANS else AGENCY_PLAN_ID


def _session_paid(session: Mapping[str, Any]) -> bool:
    status = str(session.get("payment_status") or "").strip().lower()
    if not status:
        return True
    return status in {"paid", "no_payment_required"}


def grant_paid_subscription(
    store: TenantStore,
    *,
    email: str,
    plan: str = AGENCY_PLAN_ID,
    status: str = "active",
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_checkout_session_id: str | None = None,
    paid_utc: str | None = None,
    period_start_utc: str | None = None,
    period_end_utc: str | None = None,
) -> str:
    """Record a paid Agency seat and invite the email if they are not a user yet.

    Does not create the workspace here — first sign-in still calls provision_login.
    """
    addr = normalize_email(email)
    if not addr:
        return "no_email"
    kind = (plan or AGENCY_PLAN_ID).strip().lower()
    if kind not in KNOWN_PLANS:
        kind = AGENCY_PLAN_ID
    paid = paid_utc or utc_now()
    start = period_start_utc or paid
    end = period_end_utc or period_end_from_start(start)
    user = store.get_user(addr)
    rec = BillingRecord(
        email=addr,
        plan=kind,
        status=status,
        stripe_customer_id=stripe_customer_id or None,
        stripe_subscription_id=str(stripe_subscription_id) if stripe_subscription_id else None,
        stripe_checkout_session_id=stripe_checkout_session_id or None,
        workspace_id=user.workspace_id if user is not None else None,
        paid_utc=paid,
        period_start_utc=start,
        period_end_utc=end,
    )
    prev = store.get_billing(addr)
    if prev is not None:
        rec = BillingRecord(
            email=addr,
            plan=kind,
            status=status,
            stripe_customer_id=stripe_customer_id or prev.stripe_customer_id,
            stripe_subscription_id=(
                str(stripe_subscription_id) if stripe_subscription_id else prev.stripe_subscription_id
            ),
            stripe_checkout_session_id=stripe_checkout_session_id or prev.stripe_checkout_session_id,
            workspace_id=user.workspace_id if user is not None else prev.workspace_id,
            paid_utc=paid or prev.paid_utc,
            period_start_utc=start or prev.period_start_utc,
            period_end_utc=end or prev.period_end_utc,
        )
    store.upsert_billing(rec)
    if user is not None:
        return "existing"
    store.add_invite(email=addr, kind="new_workspace", workspace_id=None)
    return "invited"


def grant_from_checkout(store: TenantStore, session: Mapping[str, Any]) -> str:
    if not _session_paid(session):
        return "unpaid"
    email = session_email(session)
    if not email:
        return "no_email"
    sub = session.get("subscription")
    sub_id = sub if isinstance(sub, str) else (sub.get("id") if isinstance(sub, dict) else None)
    customer = session.get("customer")
    customer_id = customer if isinstance(customer, str) else (
        customer.get("id") if isinstance(customer, dict) else None
    )
    return grant_paid_subscription(
        store,
        email=email,
        plan=session_plan(session),
        status="active",
        stripe_customer_id=str(customer_id) if customer_id else None,
        stripe_subscription_id=str(sub_id) if sub_id else None,
        stripe_checkout_session_id=str(session.get("id") or "") or None,
        paid_utc=utc_from_unix(session.get("created")) or utc_now(),
    )


def apply_subscription(store: TenantStore, subscription: Mapping[str, Any]) -> str:
    sub_id = str(subscription.get("id") or "") or None
    meta = subscription.get("metadata") if isinstance(subscription.get("metadata"), dict) else {}
    email = normalize_email(str(meta.get("email") or ""))
    rec = store.get_billing_by_subscription(sub_id) if sub_id else None
    if rec is None and email:
        rec = store.get_billing(email)
    if rec is None:
        return "unknown"
    stripe_status = str(subscription.get("status") or "").strip().lower()
    if stripe_status in ACTIVE_STATUSES:
        status = "active"
    elif stripe_status in {"canceled", "unpaid", "incomplete_expired"}:
        status = "canceled"
    elif stripe_status == "past_due":
        status = "past_due"
    else:
        status = rec.status
    start = utc_from_unix(subscription.get("current_period_start")) or rec.period_start_utc
    end = utc_from_unix(subscription.get("current_period_end")) or rec.period_end_utc
    store.upsert_billing(BillingRecord(
        email=rec.email,
        plan=rec.plan,
        status=status,
        stripe_customer_id=str(subscription.get("customer") or rec.stripe_customer_id or "") or rec.stripe_customer_id,
        stripe_subscription_id=sub_id or rec.stripe_subscription_id,
        stripe_checkout_session_id=rec.stripe_checkout_session_id,
        workspace_id=rec.workspace_id,
        paid_utc=rec.paid_utc,
        period_start_utc=start,
        period_end_utc=end,
    ))
    return status


def apply_stripe_event(store: TenantStore, event: Mapping[str, Any]) -> str:
    etype = str(event.get("type") or "")
    obj = event.get("data") if isinstance(event.get("data"), dict) else {}
    payload = obj.get("object") if isinstance(obj, dict) else None
    if not isinstance(payload, dict):
        return "ignored"
    if etype in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        return grant_from_checkout(store, payload)
    if etype in {"customer.subscription.updated", "customer.subscription.deleted"}:
        return apply_subscription(store, payload)
    return "ignored"


def plan_public_dict(plan: Plan) -> dict[str, Any]:
    packs, copies = typical_fast20_throughput(plan.included_fast_hours)
    return {
        "id": plan.id,
        "name": plan.name,
        "price_usd": plan.price_usd,
        "included_fast_hours": plan.included_fast_hours,
        "overage_usd_per_hour": plan.overage_usd_per_hour,
        "cogs_fast_usd_per_hour": plan.cogs_fast_usd_per_hour,
        "typical_fast20_minutes": TYPICAL_FAST20_MINUTES,
        "typical_fast20_packs": packs,
        "typical_fast20_copies": copies,
    }


def billing_status_payload(
    *,
    rec: BillingRecord | None,
    workspace: Any,
    is_admin: bool,
    environ: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Usage readout. Never blocks Generate — overage is recorded, not a hard stop."""
    if is_admin and (rec is None or rec.status not in ACTIVE_STATUSES):
        return {
            "plan": None,
            "status": "internal",
            "unlimited": True,
            "fast_seconds": 0.0,
            "included_fast_seconds": None,
            "overage_fast_seconds": 0.0,
            "overage_usd": 0.0,
            "remaining_fast_seconds": None,
            "period_start_utc": None,
            "period_end_utc": None,
            "collects_overage": False,
        }
    if rec is None or rec.status not in ACTIVE_STATUSES:
        return {
            "plan": rec.plan if rec is not None else None,
            "status": rec.status if rec is not None else "invite",
            "unlimited": True,
            "fast_seconds": 0.0,
            "included_fast_seconds": None,
            "overage_fast_seconds": 0.0,
            "overage_usd": 0.0,
            "remaining_fast_seconds": None,
            "period_start_utc": rec.period_start_utc if rec is not None else None,
            "period_end_utc": rec.period_end_utc if rec is not None else None,
            "collects_overage": False,
        }
    plan = get_plan(rec.plan, environ)
    start = _parse_utc(rec.period_start_utc)
    end = _parse_utc(rec.period_end_utc)
    seconds = period_fast_seconds(workspace, start=start, end=end) if workspace is not None else 0.0
    snap = overage_snapshot(plan, seconds)
    return {
        "plan": plan_public_dict(plan),
        "status": rec.status,
        "unlimited": False,
        "fast_seconds": snap.fast_seconds,
        "included_fast_seconds": snap.included_fast_seconds,
        "overage_fast_seconds": snap.overage_fast_seconds,
        "overage_usd": snap.overage_usd,
        "remaining_fast_seconds": snap.remaining_fast_seconds,
        "period_start_utc": rec.period_start_utc,
        "period_end_utc": rec.period_end_utc,
        "collects_overage": True,
    }
