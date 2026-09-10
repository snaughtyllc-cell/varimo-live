"""Varimo eight-variant pricing ladder — packs of 8, monthly included."""
from __future__ import annotations

import pytest

from variant_maker.server.plans import (
    PACK_SIZE,
    UsageLimitError,
    enforce_quota,
    experience_for_plan,
    get_plan,
    limit_message,
    meter_line,
    normalize_plan,
)


def test_ladder_matches_the_sell_sheet():
    payg = get_plan("payg")
    creator = get_plan("creator")
    studio = get_plan("studio")
    agency = get_plan("agency")
    assert PACK_SIZE == 8
    assert (payg.included_packs, payg.extra_pack_price, payg.monthly) == (0, 5.0, 0)
    assert (creator.included_packs, creator.extra_pack_price, creator.monthly) == (12, 3.5, 35)
    assert creator.included_variants == 96
    assert (studio.included_packs, studio.extra_pack_price, studio.monthly) == (32, 3.0, 79)
    assert studio.included_variants == 256
    assert agency.monthly == 200
    assert agency.uncapped is False
    assert agency.hard_stop is False
    assert get_plan("internal").uncapped is True


def test_missing_plan_is_internal_so_live_studios_stay_uncapped():
    assert normalize_plan(None) == "internal"
    assert normalize_plan("") == "internal"
    assert normalize_plan("pro") == "internal"
    assert get_plan(None).uncapped is True


def test_experience_follows_plan():
    assert experience_for_plan("payg") == "solo"
    assert experience_for_plan("creator") == "solo"
    assert experience_for_plan("studio") == "agency"
    assert experience_for_plan("agency") == "agency"
    assert experience_for_plan("internal") == "agency"


def test_limit_copy_points_at_the_next_upgrade():
    assert limit_message(get_plan("payg")) == (
        "Pay as you go has no included packs. Extra packs are $5.00, "
        "or Creator is $35 for 12."
    )
    assert limit_message(get_plan("creator")) == (
        "Creator includes 12 packs. Extra packs are $3.50, or Studio is $79 for 32."
    )
    assert limit_message(get_plan("studio")) == (
        "Studio includes 32 packs. Extra packs are $3.00, or Agency is $200/month."
    )
    assert get_plan("agency").uncapped is False
    assert get_plan("agency").hard_stop is False


def test_meter_line_hides_internal_and_counts_packs():
    assert meter_line(get_plan("internal"), 40) is None
    assert meter_line(get_plan("creator"), 0) == "Creator · 0 of 12 packs this month"
    assert meter_line(get_plan("creator"), 16) == "Creator · 2 of 12 packs this month"
    assert meter_line(get_plan("payg"), 8) == (
        "Pay as you go · 1 pack this month · extra $5.00"
    )


def test_enforce_quota_allows_internal_and_blocks_over_included():
    enforce_quota(get_plan("internal"), used_variants=10_000, requested=8)
    enforce_quota(get_plan("agency"), used_variants=10_000, requested=8)
    enforce_quota(get_plan("creator"), used_variants=88, requested=8)
    with pytest.raises(UsageLimitError, match="Creator includes 12 packs"):
        enforce_quota(get_plan("creator"), used_variants=96, requested=8)
    with pytest.raises(UsageLimitError, match="Pay as you go has no included"):
        enforce_quota(get_plan("payg"), used_variants=0, requested=8)
