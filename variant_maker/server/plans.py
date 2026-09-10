"""Varimo subscription plans: packs of 8, billed monthly.

Pay as you go / Creator / Studio / Agency are the sell ladder. Internal is
Jeff's uncapped operator studio. Agency is $200 / 90 Fast hours, no hard
stop — the meter drains to 0, then Usage. Missing/unknown plan ids stay
internal so existing live workspaces are not capped on deploy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from variant_maker.server.experience import Experience

PlanId = Literal["payg", "creator", "studio", "agency", "internal"]

PACK_SIZE = 8
PLAN_IDS: tuple[PlanId, ...] = ("payg", "creator", "studio", "agency", "internal")

_UPGRADE: dict[str, tuple[str, int, int]] = {
    "payg": ("Creator", 35, 12),
    "creator": ("Studio", 79, 32),
    "studio": ("Agency", 200, 0),
}


class UsageLimitError(Exception):
    """Generate is over the workspace's included packs this month."""


@dataclass(frozen=True)
class Plan:
    id: PlanId
    label: str
    monthly: int
    included_packs: int
    extra_pack_price: float
    experience: Experience
    uncapped: bool = False
    hard_stop: bool = True

    @property
    def included_variants(self) -> int:
        return self.included_packs * PACK_SIZE


PLANS: dict[str, Plan] = {
    "payg": Plan("payg", "Pay as you go", 0, 0, 5.0, "solo"),
    "creator": Plan("creator", "Creator", 35, 12, 3.5, "solo"),
    "studio": Plan("studio", "Studio", 79, 32, 3.0, "agency"),
    "agency": Plan("agency", "Agency", 200, 0, 0.75, "agency", uncapped=False, hard_stop=False),
    "internal": Plan("internal", "Internal", 0, 0, 0.0, "agency", uncapped=True, hard_stop=False),
}


def parse_plan(raw: object | None) -> PlanId | None:
    text = str(raw or "").strip().lower()
    if text in PLANS:
        return text  # type: ignore[return-value]
    return None


def normalize_plan(raw: object | None) -> PlanId:
    return parse_plan(raw) or "internal"


def get_plan(raw: object | None) -> Plan:
    if isinstance(raw, Plan):
        return raw
    return PLANS[normalize_plan(raw)]


def experience_for_plan(plan_id: object | None) -> Experience:
    return get_plan(plan_id).experience


def _pack_count_label(used_variants: int) -> str:
    packs = used_variants / PACK_SIZE
    if packs == int(packs):
        count = int(packs)
        noun = "pack" if count == 1 else "packs"
        return f"{count} {noun}"
    return f"{packs:.1f} packs"


def meter_line(plan: Plan, used_variants: int) -> str | None:
    if plan.uncapped:
        return None
    used = _pack_count_label(used_variants)
    if plan.included_packs == 0:
        extra = f"${plan.extra_pack_price:.2f}"
        return f"{plan.label} · {used} this month · extra {extra}"
    used_packs = used_variants / PACK_SIZE
    shown = str(int(used_packs)) if used_packs == int(used_packs) else f"{used_packs:.1f}"
    return f"{plan.label} · {shown} of {plan.included_packs} packs this month"


def limit_message(plan: Plan) -> str:
    extra = f"${plan.extra_pack_price:.2f}"
    nxt = _UPGRADE.get(plan.id)
    if plan.included_packs == 0:
        if nxt:
            name, price, packs = nxt
            if packs:
                return (
                    f"{plan.label} has no included packs. Extra packs are {extra}, "
                    f"or {name} is ${price} for {packs}."
                )
            return (
                f"{plan.label} has no included packs. Extra packs are {extra}, "
                f"or {name} is ${price}/month."
            )
        return f"{plan.label} has no included packs. Extra packs are {extra}."
    if nxt:
        name, price, packs = nxt
        if packs:
            return (
                f"{plan.label} includes {plan.included_packs} packs. Extra packs are {extra}, "
                f"or {name} is ${price} for {packs}."
            )
        return (
            f"{plan.label} includes {plan.included_packs} packs. Extra packs are {extra}, "
            f"or {name} is ${price}/month."
        )
    return (
        f"{plan.label} includes {plan.included_packs} packs. Extra packs are {extra}."
    )


def remaining_pct(used_variants: int, included_variants: int) -> int:
    """100 = unused. 0 = included packs are gone."""
    included = max(0, int(included_variants))
    if included <= 0:
        return 0
    left = max(0, included - max(0, int(used_variants)))
    return round(100 * left / included)


def enforce_quota(plan: Plan, used_variants: int, requested: int) -> None:
    if plan.uncapped or not plan.hard_stop:
        return
    if used_variants + max(0, int(requested)) > plan.included_variants:
        raise UsageLimitError(limit_message(plan))
