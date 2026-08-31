import pytest

from variant_maker.presets import MEDIUM, STRONG, SUBTLE
from variant_maker.sampler import (
    _VIDEO_AXES,
    CROP_DRIFT_MAX_DEFAULT,
    CROP_DRIFT_MAX_TALKING_HEAD,
    CROP_OFFSET_HI,
    CROP_OFFSET_LO,
    CROP_Y_KEEP_BOTTOM_HI,
    CROP_Y_KEEP_BOTTOM_LO,
    FPS_CHOICES,
    RESAMPLE_FLAGS,
    RESAMPLE_PX_CHOICES,
    _axis_distortion,
    apply_rotate_safe,
    clamp_crop_drift,
    clamp_strength,
    clamp_trims,
    derive_seed,
    disable_fast_pixel_ops,
    ensure_crop_travel,
    sample,
    total_distortion,
)

# A deterministic spread of per-variant seeds for distribution tests.
SEEDS = [derive_seed(20260627, i) for i in range(400)]

# Color/geometry axes that MUST straddle neutral (CLAUDE invariant 2): axis -> neutral.
ZERO_MEAN_AXES = {
    "brightness": 0.0,
    "contrast": 1.0,
    "saturation": 1.0,
    "gamma": 1.0,
    "hue_deg": 0.0,
    "rotate_deg": 0.0,
    "warp_k1": 0.0,
}

VIDEO_RANGE_AXES = (
    "crop_keep", "rotate_deg", "brightness", "contrast", "saturation",
    "gamma", "hue_deg", "vignette", "grain", "unsharp", "warp_k1", "rebuild_scale",
    "speed", "trim_s",
)


def test_derive_seed_is_deterministic():
    assert derive_seed(42, 1) == derive_seed(42, 1)
    assert derive_seed(42, 1) != derive_seed(42, 2)


def test_sample_is_reproducible():
    s = derive_seed(42, 1)
    assert sample(MEDIUM, s) == sample(MEDIUM, s)


def test_distinct_seeds_give_distinct_params():
    assert sample(MEDIUM, derive_seed(42, 1)) != sample(MEDIUM, derive_seed(42, 2))


def test_audio_speed_matches_video_speed():
    p = sample(MEDIUM, derive_seed(1, 1))
    assert p["audio"]["speed"] == p["video"]["speed"]


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_total_distortion_within_budget(preset):
    """Sampled axes are scaled down so total normalized distortion fits the budget."""
    for s in SEEDS:
        d = total_distortion(preset, sample(preset, s))
        assert d <= preset.budget + 1e-9, f"{preset.name}: {d:.4f} > budget {preset.budget}"


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_color_axes_zero_mean(preset):
    """Over many seeds, each color/geometry axis averages to neutral — no systematic shift."""
    for axis, neutral in ZERO_MEAN_AXES.items():
        vals = [sample(preset, s)["video"][axis] for s in SEEDS]
        mean = sum(vals) / len(vals)
        reach = max((abs(v - neutral) for v in vals), default=0.0) or 1.0
        assert abs(mean - neutral) < 0.1 * reach, (
            f"{preset.name}.{axis} biased: mean={mean:.5f} neutral={neutral}"
        )


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_video_axes_within_range_bounds(preset):
    for s in SEEDS:
        v = sample(preset, s)["video"]
        for axis in VIDEO_RANGE_AXES:
            r = getattr(preset, axis)
            assert r.lo - 1e-9 <= v[axis] <= r.hi + 1e-9, (
                f"{preset.name}.{axis}={v[axis]} out of [{r.lo}, {r.hi}]"
            )
        assert preset.crf.lo <= v["crf"] <= preset.crf.hi
        assert v["crf"] == int(v["crf"])  # encoder setting is an integer
        assert v["gop"] in preset.gop_choices
        assert v["out_fps"] in FPS_CHOICES


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_audio_within_range_bounds(preset):
    for s in SEEDS[:50]:
        a = sample(preset, s, audio_uniqueness=True)["audio"]
        assert preset.loudnorm_i.lo <= a["loudnorm_i"] <= preset.loudnorm_i.hi
        assert preset.aac_kbps.lo <= a["aac_kbps"] <= preset.aac_kbps.hi
        assert len(a["eq_gains"]) == preset.eq_bands
        for g in a["eq_gains"]:
            assert preset.eq_gain_db.lo <= g <= preset.eq_gain_db.hi


def test_strength_one_is_the_default():
    s = derive_seed(7, 3)
    assert sample(MEDIUM, s) == sample(MEDIUM, s, strength=1.0)


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_strength_scales_the_budget(preset):
    """The AI/quality-guard drives intensity via `strength`: it caps spend at strength*budget."""
    for s in SEEDS[:100]:
        for k in (0.25, 0.5, 0.75):
            d = total_distortion(preset, sample(preset, s, strength=k))
            assert d <= k * preset.budget + 1e-9, f"{preset.name} k={k}: {d:.4f}"


def test_zero_strength_is_neutral():
    v = sample(MEDIUM, derive_seed(5, 2), strength=0.0)["video"]
    assert total_distortion(MEDIUM, {"video": v}) <= 1e-9


def test_clamp_strength_allows_up_to_two():
    """Cap raised from 1.0 to 2.0 so the uniqueness ladder's escalating rungs (e.g.
    1.0 -> 1.25 -> 1.5) don't all collapse to the same clamped value (Task 3 bug)."""
    assert clamp_strength(1.25) == 1.25
    assert clamp_strength(1.5) == 1.5
    assert clamp_strength(2.0) == 2.0
    assert clamp_strength(2.5) == 2.0  # still hard-capped, just at 2.0 now
    assert clamp_strength(-1.0) == 0.0


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_strength_above_one_can_exceed_the_nominal_budget(preset):
    """Above 1.0, `strength` caps spend at strength*budget (up to 2x), not budget itself."""
    for s in SEEDS[:100]:
        for k in (1.25, 1.5, 2.0):
            d = total_distortion(preset, sample(preset, s, strength=k))
            assert d <= k * preset.budget + 1e-9, f"{preset.name} k={k}: {d:.4f}"


def test_strength_above_one_diverges_from_strength_one():
    """The uniqueness ladder only spends more budget on later rungs if strengths above
    1.0 actually produce different params than 1.0 — regression test for the bug where
    sample() hard-capped strength at 1.0, making 1.0/1.25/1.5 identical renders."""
    diverged = False
    for s in SEEDS:
        p1 = sample(MEDIUM, s, strength=1.0)
        p15 = sample(MEDIUM, s, strength=1.5)
        if p1["video"] != p15["video"]:
            diverged = True
            break
    assert diverged, "strength=1.5 must diverge from strength=1.0 for at least one seed"


def test_crf_counts_toward_the_budget():
    """CRF is a budgeted axis (Q1 'more correct'): perturbing it changes total distortion."""
    p = sample(MEDIUM, derive_seed(9, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"]["crf"] = min(MEDIUM.crf.hi, p["video"]["crf"] + 1)
    if bumped["video"]["crf"] != p["video"]["crf"]:
        assert total_distortion(MEDIUM, bumped) > base


def test_pitch_is_zero_without_rubberband():
    for s in SEEDS[:50]:
        assert sample(MEDIUM, s, rubberband=False)["audio"]["pitch_pct"] == 0.0


def test_pitch_within_range_with_rubberband():
    for s in SEEDS[:50]:
        pp = sample(MEDIUM, s, rubberband=True, audio_uniqueness=True)["audio"]["pitch_pct"]
        assert MEDIUM.pitch_pct.lo <= pp <= MEDIUM.pitch_pct.hi


def test_voice_safe_audio_skips_uniqueness_axes_by_default():
    """Talking clips keep natural audio. Pitch/EQ/loudnorm are the robotic sound."""
    for s in SEEDS[:50]:
        a = sample(MEDIUM, s, rubberband=True)["audio"]
        assert a["pitch_pct"] == 0.0
        assert a["loudnorm_i"] is None
        assert all(g == 0.0 for g in a["eq_gains"])


def test_audio_uniqueness_draws_eq_and_loudnorm():
    for s in SEEDS[:50]:
        a = sample(MEDIUM, s, audio_uniqueness=True)["audio"]
        assert MEDIUM.loudnorm_i.lo <= a["loudnorm_i"] <= MEDIUM.loudnorm_i.hi
        assert len(a["eq_gains"]) == MEDIUM.eq_bands
        for g in a["eq_gains"]:
            assert MEDIUM.eq_gain_db.lo <= g <= MEDIUM.eq_gain_db.hi


def test_sample_includes_crop_offset_and_trim_end():
    p = sample(MEDIUM, seed=1)
    assert CROP_OFFSET_LO <= p["video"]["crop_x_frac"] <= CROP_OFFSET_HI
    assert CROP_OFFSET_LO <= p["video"]["crop_y_frac"] <= CROP_OFFSET_HI
    assert p["video"]["trim_end_s"] >= 0.0


@pytest.mark.parametrize("preset", [SUBTLE, MEDIUM, STRONG])
def test_crop_offset_and_trim_end_within_bounds(preset):
    for s in SEEDS[:100]:
        v = sample(preset, s)["video"]
        assert CROP_OFFSET_LO <= v["crop_x_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_y_frac"] <= CROP_OFFSET_HI
        assert preset.trim_s.lo - 1e-9 <= v["trim_end_s"] <= preset.trim_s.hi + 1e-9


def test_crop_offset_stays_off_caption_edges():
    """Live pack ced7cbec7c49 slid y=0.10 / x=0.99 and cropped a word.
    The leftover window must stay near center so burned-in text survives.
    """
    assert CROP_OFFSET_LO == pytest.approx(0.35)
    assert CROP_OFFSET_HI == pytest.approx(0.65)
    for s in SEEDS[:200]:
        v = sample(MEDIUM, s)["video"]
        assert 0.35 - 1e-9 <= v["crop_x_frac"] <= 0.65 + 1e-9
        assert 0.35 - 1e-9 <= v["crop_y_frac"] <= 0.65 + 1e-9
        # 0..1 edge slides are the miss — never emit them.
        assert v["crop_x_frac"] > 0.2
        assert v["crop_y_frac"] < 0.8


def test_instagram_720_crop_punches_from_top_and_keeps_bottom():
    """Timed 720 talking-head: centered keep 0.92 = 20 bits (miss). y→1.0 keep
    0.86–0.90 = 25–26 bits and does not slide onto a bottom caption."""
    assert CROP_Y_KEEP_BOTTOM_LO == pytest.approx(0.90)
    assert CROP_Y_KEEP_BOTTOM_HI == pytest.approx(1.00)
    for s in SEEDS[:200]:
        v = sample(MEDIUM, s, shot="talking_head", width=720, height=1280)["video"]
        assert 0.86 - 1e-9 <= v["crop_keep"] <= 0.90 + 1e-9
        assert CROP_OFFSET_LO <= v["crop_x_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_x_end_frac"] <= CROP_OFFSET_HI
        assert CROP_Y_KEEP_BOTTOM_LO - 1e-9 <= v["crop_y_frac"] <= CROP_Y_KEEP_BOTTOM_HI + 1e-9
        assert CROP_Y_KEEP_BOTTOM_LO - 1e-9 <= v["crop_y_end_frac"] <= CROP_Y_KEEP_BOTTOM_HI + 1e-9
        assert v["crop_y_frac"] > 0.8
        assert v["crop_y_end_frac"] > 0.8
    # 1080 talking-head keeps the signed caption-safe center band.
    for s in SEEDS[:80]:
        v = sample(MEDIUM, s, shot="talking_head", width=1080, height=1920)["video"]
        assert MEDIUM.crop_keep.lo - 1e-9 <= v["crop_keep"] <= MEDIUM.crop_keep.hi + 1e-9
        assert CROP_OFFSET_LO <= v["crop_y_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_y_end_frac"] <= CROP_OFFSET_HI


def test_instagram_720_motion_keeps_bottom_captions_without_th_punch():
    v = sample(MEDIUM, SEEDS[0], shot="motion", width=720, height=1280)["video"]
    assert MEDIUM.crop_keep.lo - 1e-9 <= v["crop_keep"] <= MEDIUM.crop_keep.hi + 1e-9
    assert v["crop_y_frac"] >= CROP_Y_KEEP_BOTTOM_LO - 1e-9
    assert v["crop_y_end_frac"] >= CROP_Y_KEEP_BOTTOM_LO - 1e-9


def test_crop_offset_axes_are_zero_mean():
    """Fingerprint offset axes must not systematically drift toward one edge."""
    for axis in ("crop_x_frac", "crop_y_frac"):
        vals = [sample(MEDIUM, s)["video"][axis] for s in SEEDS]
        mean = sum(vals) / len(vals)
        assert abs(mean - 0.5) < 0.05, f"{axis} biased: mean={mean:.5f}"


def test_crop_offset_and_trim_end_are_unbudgeted():
    """These are fingerprint-only axes; they must never count toward the distortion budget."""
    p = sample(MEDIUM, derive_seed(3, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"].update({"crop_x_frac": 0.0, "crop_y_frac": 1.0, "trim_end_s": 5.0})
    assert total_distortion(MEDIUM, bumped) == base


def test_crop_keep_is_unbudgeted_fingerprint():
    """Crop is the vs-source uniqueness lever; VMAF already ignores it. Strength must not
    shrink keep toward 1.0 when color/warp overspend — that is the 35% / all-esc look."""
    p = sample(MEDIUM, derive_seed(3, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"]["crop_keep"] = MEDIUM.crop_keep.lo
    assert total_distortion(MEDIUM, bumped) == base
    seed = derive_seed(42, 7)
    mild = sample(MEDIUM, seed, strength=0.25)["video"]["crop_keep"]
    full = sample(MEDIUM, seed, strength=1.0)["video"]["crop_keep"]
    strong = sample(MEDIUM, seed, strength=1.8)["video"]["crop_keep"]
    assert mild == full == strong
    assert MEDIUM.crop_keep.lo <= mild <= MEDIUM.crop_keep.hi


def test_medium_crop_range_is_tighter_than_identity():
    """Face-only keep=0.72 scored *worse* SSIM. 0.84–0.90 with a 0..1 window
    cropped a burned-in word on live pack ced7cbec7c49 (keep 0.84, y=0.14).
    1080 medium stays 4–8% centered. Instagram 720 talking-head remaps keep
    (see test_instagram_720_crop). Escalate is a bit tighter, not face-zoom.
    Gate stays 24.
    """
    assert MEDIUM.crop_keep.lo == pytest.approx(0.92)
    assert MEDIUM.crop_keep.hi == pytest.approx(0.96)
    assert STRONG.crop_keep.lo < MEDIUM.crop_keep.lo
    assert STRONG.crop_keep.lo == pytest.approx(0.88)
    assert STRONG.crop_keep.hi == pytest.approx(0.93)
    for s in SEEDS[:80]:
        keep = sample(MEDIUM, s)["video"]["crop_keep"]
        assert keep <= 0.96 + 1e-9
        assert keep >= 0.92 - 1e-9


def test_grain_is_texture_under_the_social_cap():
    """Grain moves talking-head SSIM; 14–22 without a cap wrote ~65 Mbps.
    Social 12M is the file-size ceiling — grain can sit in the uniqueness band.
    """
    assert MEDIUM.grain.lo == pytest.approx(7)
    assert MEDIUM.grain.hi == pytest.approx(12)
    assert STRONG.grain.lo == pytest.approx(10)
    assert STRONG.grain.hi == pytest.approx(16)
    assert STRONG.grain.hi > MEDIUM.grain.hi
    assert MEDIUM.grain.lo >= SUBTLE.grain.lo


def test_clamp_trims_keeps_half_of_a_short_clip():
    """Strong-range head+tail (~0.85+0.85) must not gut a 1s source."""
    start, end = clamp_trims(0.85, 0.85, 1.0)
    assert start + end == pytest.approx(0.5)
    assert start == pytest.approx(end)
    assert start > 0.0


def test_clamp_trims_leaves_long_clips_alone():
    start, end = clamp_trims(0.2, 0.5, 10.0)
    assert (start, end) == (0.2, 0.5)


def test_over_budget_shrink_kills_encode_before_look():
    """When over budget, shrink grain/unsharp/crf first; color AND crop both survive."""
    encode_names = {"grain", "unsharp", "crf"}
    look_names = {
        "rotate_deg",
        "brightness", "contrast", "saturation", "gamma", "hue_deg",
        "warp_k1",
    }
    encode_ds: list[float] = []
    look_ds: list[float] = []
    for s in SEEDS:
        params = sample(MEDIUM, s)
        assert total_distortion(MEDIUM, params) <= MEDIUM.budget + 1e-9
        v = params["video"]
        for name, kind, ref, budgeted in _VIDEO_AXES:
            if not budgeted:
                continue
            d = _axis_distortion(
                kind, ref, getattr(MEDIUM, name).lo, getattr(MEDIUM, name).hi, v[name],
            )
            if name in encode_names:
                encode_ds.append(d)
            elif name in look_names:
                look_ds.append(d)
    mean_encode = sum(encode_ds) / len(encode_ds)
    mean_look = sum(look_ds) / len(look_ds)
    assert mean_look > mean_encode + 0.05, (
        f"look (color+geo) should retain more than grain/encode: "
        f"look={mean_look:.4f} encode={mean_encode:.4f}"
    )


def test_sample_with_duration_scales_trims_on_short_clips():
    p = sample(STRONG, derive_seed(7, 1), duration_s=1.0)
    v = p["video"]
    remaining = 1.0 - v["trim_s"] - v["trim_end_s"]
    assert remaining >= 0.5 - 1e-9
    unbounded = sample(STRONG, derive_seed(7, 1))
    assert unbounded["video"]["trim_s"] + unbounded["video"]["trim_end_s"] > (
        v["trim_s"] + v["trim_end_s"]
    )


def test_overbudget_shrink_is_encode_first_look_survives():
    """Tight budget collapses grain; saturation and crop_keep still move (look shows)."""
    grains_at_calm = 0
    sat_off = 0
    crop_off = 0
    for s in SEEDS[:200]:
        tight = sample(MEDIUM, s, strength=0.25)["video"]
        if abs(tight["grain"] - MEDIUM.grain.lo) < 1e-6:
            grains_at_calm += 1
        if abs(tight["saturation"] - 1.0) > 1e-4:
            sat_off += 1
        if abs(tight["crop_keep"] - MEDIUM.crop_keep.hi) > 1e-4:
            crop_off += 1
    assert grains_at_calm > 150, f"grain at calm on {grains_at_calm}/200"
    assert sat_off > 50, f"saturation still showing on {sat_off}/200"
    assert crop_off > 50, f"crop still showing on {crop_off}/200"


def test_sample_draws_resample_fingerprint():
    p = sample(MEDIUM, derive_seed(11, 2))
    v = p["video"]
    assert v["resample_px"] in RESAMPLE_PX_CHOICES
    assert v["resample_px"] != 0
    assert v["resample_px"] % 2 == 0
    assert v["resample_flags"] in RESAMPLE_FLAGS


def test_fast_pixel_seed_resample_is_a_real_roundtrip():
    """Legacy ±px leftover: still drawn, but uniqueness now uses rebuild_scale.

    Tiny ±8–32 on 1080 is invisible at the 576×1024 uniqueness frame.
    """
    assert min(abs(x) for x in RESAMPLE_PX_CHOICES) == 8
    assert max(abs(x) for x in RESAMPLE_PX_CHOICES) == 32
    assert all(x % 2 == 0 and x != 0 for x in RESAMPLE_PX_CHOICES)
    assert any(x < 0 for x in RESAMPLE_PX_CHOICES) and any(x > 0 for x in RESAMPLE_PX_CHOICES)
    for s in SEEDS[:40]:
        px = sample(MEDIUM, s)["video"]["resample_px"]
        assert abs(px) >= 8
        assert abs(px) <= 32


def test_medium_rebuild_scale_is_a_visible_roundtrip():
    """Fast analog of Pixel AI: downscale to ~720–864 then back to 1080×1920.

    Talking-head ±32 px scored 25–33%. Gate stays 24. Escalate rebuild is heavier
    (strong.hi < medium.lo) — not a louder crop.
    """
    assert MEDIUM.rebuild_scale.lo == pytest.approx(0.67)
    assert MEDIUM.rebuild_scale.hi == pytest.approx(0.80)
    assert STRONG.rebuild_scale.lo == pytest.approx(0.50)
    assert STRONG.rebuild_scale.hi == pytest.approx(0.66)
    assert STRONG.rebuild_scale.hi < MEDIUM.rebuild_scale.lo
    assert SUBTLE.rebuild_scale.lo == pytest.approx(0.90)
    assert SUBTLE.rebuild_scale.hi == pytest.approx(0.98)
    for s in SEEDS:
        scale = sample(MEDIUM, s)["video"]["rebuild_scale"]
        assert MEDIUM.rebuild_scale.lo - 1e-9 <= scale <= MEDIUM.rebuild_scale.hi + 1e-9
        assert scale < 1.0
    for s in SEEDS[:80]:
        scale = sample(STRONG, s)["video"]["rebuild_scale"]
        assert STRONG.rebuild_scale.lo - 1e-9 <= scale <= STRONG.rebuild_scale.hi + 1e-9


def test_rebuild_scale_is_unbudgeted_fingerprint():
    """Rebuild is the vs-source uniqueness lever the 576×1024 frame can see.
    Strength / VMAF shrink must not pull it to identity.
    """
    p = sample(MEDIUM, derive_seed(3, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"]["rebuild_scale"] = MEDIUM.rebuild_scale.lo
    assert total_distortion(MEDIUM, bumped) == base
    seed = derive_seed(42, 7)
    mild = sample(MEDIUM, seed, strength=0.25)["video"]["rebuild_scale"]
    full = sample(MEDIUM, seed, strength=1.0)["video"]["rebuild_scale"]
    strong = sample(MEDIUM, seed, strength=1.8)["video"]["rebuild_scale"]
    assert mild == full == strong
    assert MEDIUM.rebuild_scale.lo <= mild <= MEDIUM.rebuild_scale.hi


def test_medium_warp_pixel_seed_is_stronger_than_a_peek():
    """lenscorrection k1 is the Fast pixel seed VMAF can still cap. Strong stays above."""
    assert MEDIUM.warp_k1.hi == pytest.approx(0.015)
    assert MEDIUM.warp_k1.lo == pytest.approx(-0.015)
    assert STRONG.warp_k1.hi > MEDIUM.warp_k1.hi
    assert STRONG.warp_k1.hi == pytest.approx(0.020)


def test_resample_is_unbudgeted_and_zero_meanish():
    p = sample(MEDIUM, derive_seed(3, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"]["resample_px"] = 16
    bumped["video"]["resample_flags"] = "bicubic"
    assert total_distortion(MEDIUM, bumped) == base
    pxs = [sample(MEDIUM, s)["video"]["resample_px"] for s in SEEDS]
    assert abs(sum(pxs) / len(pxs)) < 2.0


def test_warp_k1_is_budgeted_zero_mean():
    """Warp stays VMAF-capped. Unbudgeted warp on talking-head scored VMAF 53–80
    → best_effort → Drive dropped the files. Rebuild_scale is the uniqueness lever.
    """
    p = sample(MEDIUM, derive_seed(9, 2))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    if abs(p["video"]["warp_k1"]) < MEDIUM.warp_k1.hi - 1e-9:
        bumped["video"]["warp_k1"] = MEDIUM.warp_k1.hi
        assert total_distortion(MEDIUM, bumped) > base
    vals = [sample(MEDIUM, s)["video"]["warp_k1"] for s in SEEDS]
    mean = sum(vals) / len(vals)
    assert abs(mean) < 0.002
    assert MEDIUM.warp_k1.hi == pytest.approx(0.015)
    assert STRONG.warp_k1.hi == pytest.approx(0.020)


def test_disable_fast_pixel_ops_zeros_resample_rebuild_and_warp():
    p = sample(MEDIUM, derive_seed(1, 4))
    out = disable_fast_pixel_ops(p)
    assert out["video"]["resample_px"] == 0
    assert out["video"]["rebuild_scale"] == 1.0
    assert out["video"]["warp_k1"] == 0.0
    assert p["video"]["rebuild_scale"] < 1.0
    assert out["video"]["crop_keep"] == p["video"]["crop_keep"]
    shaded = sample(STRONG, derive_seed(1, 4), shot="talking_head", width=720, height=1280)
    assert "luma_shade" not in shaded["video"]
    hq = disable_fast_pixel_ops(shaded)
    assert hq["video"]["luma_shade"] == 0.0
    assert hq["video"]["crop_keep"] == shaded["video"]["crop_keep"]


def test_shot_none_matches_omitted_shot():
    s = derive_seed(42, 3)
    assert sample(MEDIUM, s) == sample(MEDIUM, s, shot=None)


def test_talking_head_uses_heavier_grain_keeps_crop_and_sharp_rebuild():
    """Look-first: 576 sees grain on a still face, not a mushy rebuild. Crop stays."""
    seed = derive_seed(11, 5)
    plain = sample(MEDIUM, seed)
    head = sample(MEDIUM, seed, shot="talking_head")
    assert head["video"]["crop_keep"] == plain["video"]["crop_keep"]
    # noise_chroma is a flag, not an extra draw — fingerprint RNG stays aligned.
    assert head["video"]["crop_x_frac"] == plain["video"]["crop_x_frac"]
    assert head["video"]["resample_px"] == plain["video"]["resample_px"]
    assert 0.90 - 1e-9 <= head["video"]["rebuild_scale"] <= 0.98 + 1e-9
    assert head["video"]["rebuild_scale"] > plain["video"]["rebuild_scale"] - 1e-9
    for s in SEEDS[:80]:
        v = sample(MEDIUM, s, shot="talking_head")["video"]
        assert 0.90 - 1e-9 <= v["rebuild_scale"] <= 0.98 + 1e-9
        assert 34 - 1e-9 <= v["grain"] <= 42 + 1e-9
        assert v.get("noise_chroma") is True
        assert v.get("noise_seed") == s & 0x7FFFFFFF
    strong = sample(STRONG, seed, shot="talking_head")["video"]
    assert 0.85 - 1e-9 <= strong["rebuild_scale"] <= 0.94 + 1e-9
    assert 46 - 1e-9 <= strong["grain"] <= 58 + 1e-9
    assert strong.get("noise_chroma") is True
    assert strong.get("noise_seed") == seed & 0x7FFFFFFF
    assert "noise_chroma" not in plain["video"]
    assert "noise_seed" not in plain["video"]
    other = sample(MEDIUM, seed + 1, shot="talking_head")["video"]
    assert other["noise_seed"] != head["video"]["noise_seed"]


def test_talking_head_grain_is_vmaf_shrinkable():
    """Talking-head uniqueness grain stays in the shot band (not preset.lo, not 40–52).

    Look-overspend must not collapse it to shot.lo — that pinned every copy at 28
    and made VMAF strength a no-op. The band itself is the VMAF ceiling.
    """
    vals = []
    for s in SEEDS[:80]:
        mild = sample(MEDIUM, s, shot="talking_head", strength=0.25)["video"]["grain"]
        full = sample(MEDIUM, s, shot="talking_head", strength=1.0)["video"]["grain"]
        assert 34 - 1e-9 <= mild <= 42 + 1e-9
        assert 34 - 1e-9 <= full <= 42 + 1e-9
        vals.append(full)
    assert min(vals) < max(vals)
    assert max(vals) > 34 + 0.2
    plain = sample(MEDIUM, SEEDS[0], strength=0.25)["video"]["grain"]
    head = sample(MEDIUM, SEEDS[0], shot="talking_head", strength=0.25)["video"]["grain"]
    assert head > plain + 1e-9


def test_motion_uses_gentler_rebuild():
    for s in SEEDS[:80]:
        scale = sample(MEDIUM, s, shot="motion")["video"]["rebuild_scale"]
        assert 0.78 - 1e-9 <= scale <= 0.90 + 1e-9
    for s in SEEDS[:40]:
        scale = sample(STRONG, s, shot="motion")["video"]["rebuild_scale"]
        assert 0.67 - 1e-9 <= scale <= 0.80 + 1e-9


def test_motion_keeps_budgeted_grain():
    """Motion already scores from movement; don't remap grain off the preset."""
    s = derive_seed(42, 3)
    plain = sample(MEDIUM, s)
    moved = sample(MEDIUM, s, shot="motion")
    assert moved["video"]["grain"] == plain["video"]["grain"]
    assert moved["video"]["crop_keep"] == plain["video"]["crop_keep"]
    assert "noise_chroma" not in moved["video"]
    assert "noise_chroma" not in plain["video"]
    assert "noise_seed" not in moved["video"]
    assert "noise_seed" not in plain["video"]
    assert "chroma_cloud" not in moved["video"]
    assert "chroma_cloud" not in plain["video"]
    assert "luma_dust" not in moved["video"]
    assert "luma_dust" not in plain["video"]


def test_talking_head_chroma_cloud_from_grain_no_extra_rng():
    """720 uniqueness overlay tracks grain. Same seed must not shift crop/resample."""
    from variant_maker.shot import chroma_cloud_range_for_shot

    seed = derive_seed(11, 5)
    plain = sample(MEDIUM, seed)
    head = sample(MEDIUM, seed, shot="talking_head")
    assert "chroma_cloud" not in plain["video"]
    cloud_r = chroma_cloud_range_for_shot(MEDIUM, "talking_head")
    assert cloud_r is not None
    assert cloud_r.lo - 1e-9 <= head["video"]["chroma_cloud"] <= cloud_r.hi + 1e-9
    assert head["video"]["crop_x_frac"] == plain["video"]["crop_x_frac"]
    assert head["video"]["resample_px"] == plain["video"]["resample_px"]
    grain_span = 42.0 - 34.0
    expect = cloud_r.lo + (head["video"]["grain"] - 34.0) / grain_span * (cloud_r.hi - cloud_r.lo)
    assert head["video"]["chroma_cloud"] == pytest.approx(expect)
    assert cloud_r.lo == 4 and cloud_r.hi == 7
    assert chroma_cloud_range_for_shot(MEDIUM, "motion") is None
    assert chroma_cloud_range_for_shot(MEDIUM, None) is None


def test_talking_head_luma_dust_from_grain_no_extra_rng():
    """720 luma dust tracks grain. Same seed must not shift crop/resample/cloud."""
    from variant_maker.shot import chroma_cloud_range_for_shot, luma_dust_range_for_shot

    seed = derive_seed(11, 5)
    plain = sample(MEDIUM, seed)
    head = sample(MEDIUM, seed, shot="talking_head")
    assert "luma_dust" not in plain["video"]
    dust_r = luma_dust_range_for_shot(MEDIUM, "talking_head")
    assert dust_r is not None
    assert dust_r.lo - 1e-9 <= head["video"]["luma_dust"] <= dust_r.hi + 1e-9
    assert head["video"]["crop_x_frac"] == plain["video"]["crop_x_frac"]
    assert head["video"]["resample_px"] == plain["video"]["resample_px"]
    grain_span = 42.0 - 34.0
    expect = dust_r.lo + (head["video"]["grain"] - 34.0) / grain_span * (dust_r.hi - dust_r.lo)
    assert head["video"]["luma_dust"] == pytest.approx(expect)
    assert dust_r.lo == 11 and dust_r.hi == 13
    cloud_r = chroma_cloud_range_for_shot(MEDIUM, "talking_head")
    assert cloud_r is not None
    assert head["video"]["chroma_cloud"] == pytest.approx(
        cloud_r.lo + (head["video"]["grain"] - 34.0) / grain_span * (cloud_r.hi - cloud_r.lo),
    )
    assert luma_dust_range_for_shot(MEDIUM, "motion") is None
    assert luma_dust_range_for_shot(MEDIUM, None) is None


def test_strong_720_talking_head_does_not_draw_luma_shade():
    """lookaqmtp lava is rejected. Strong 720 still pins cloud 7 / dust 13."""
    from variant_maker.shot import luma_shade_range_for_shot

    seed = derive_seed(11, 5)
    plain = sample(STRONG, seed)
    med = sample(MEDIUM, seed, shot="talking_head", width=720, height=1280)
    head = sample(STRONG, seed, shot="talking_head", width=720, height=1280)
    assert "luma_shade" not in plain["video"]
    assert "luma_shade" not in med["video"]
    assert "luma_shade" not in head["video"]
    assert luma_shade_range_for_shot(STRONG, "talking_head", 720, 1280) is None
    assert head["video"]["chroma_cloud"] == pytest.approx(7.0)
    assert head["video"]["luma_dust"] == pytest.approx(13.0)
    assert head["video"]["crop_x_frac"] == plain["video"]["crop_x_frac"]
    assert head["video"]["resample_px"] == plain["video"]["resample_px"]
    wide = sample(STRONG, seed, shot="talking_head", width=1080, height=1920)
    assert "luma_shade" not in wide["video"]
    grain_span = 58.0 - 46.0
    expect_cloud = 4.0 + (wide["video"]["grain"] - 46.0) / grain_span * 3.0
    assert wide["video"]["chroma_cloud"] == pytest.approx(expect_cloud)
    moved = sample(STRONG, seed, shot="motion", width=720, height=1280)
    assert "luma_shade" not in moved["video"]


def test_crop_end_does_not_shift_existing_fingerprint_draws():
    """Drift uses a separate RNG; start crop / trim_end / resample stay seed-stable."""
    seed = derive_seed(11, 5)
    plain = sample(MEDIUM, seed)
    head = sample(MEDIUM, seed, shot="talking_head")
    assert plain["video"]["crop_x_frac"] == head["video"]["crop_x_frac"]
    assert plain["video"]["crop_y_frac"] == head["video"]["crop_y_frac"]
    assert plain["video"]["trim_end_s"] == head["video"]["trim_end_s"]
    assert plain["video"]["resample_px"] == head["video"]["resample_px"]
    assert "crop_x_end_frac" in plain["video"]
    assert "crop_y_end_frac" in plain["video"]
    assert "crop_x_end_frac" in head["video"]
    assert "crop_y_end_frac" in head["video"]
    assert "crop_hand_amp_x" in plain["video"]
    assert "crop_hand_p1" in plain["video"]


def test_crop_end_fracs_in_same_legal_ranges_as_start():
    for s in SEEDS[:200]:
        v = sample(MEDIUM, s)["video"]
        assert CROP_OFFSET_LO <= v["crop_x_end_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_y_end_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_x_frac"] <= CROP_OFFSET_HI
        assert CROP_OFFSET_LO <= v["crop_y_frac"] <= CROP_OFFSET_HI


def test_crop_drift_respects_max_delta_for_shot():
    assert CROP_DRIFT_MAX_TALKING_HEAD == pytest.approx(0.24)
    assert CROP_DRIFT_MAX_DEFAULT == pytest.approx(0.28)
    for s in SEEDS[:200]:
        th = sample(MEDIUM, s, shot="talking_head")["video"]
        assert abs(th["crop_x_end_frac"] - th["crop_x_frac"]) <= CROP_DRIFT_MAX_TALKING_HEAD + 1e-9
        assert abs(th["crop_y_end_frac"] - th["crop_y_frac"]) <= CROP_DRIFT_MAX_TALKING_HEAD + 1e-9
        moved = sample(MEDIUM, s, shot="motion")["video"]
        assert abs(moved["crop_x_end_frac"] - moved["crop_x_frac"]) <= CROP_DRIFT_MAX_DEFAULT + 1e-9
        assert abs(moved["crop_y_end_frac"] - moved["crop_y_frac"]) <= CROP_DRIFT_MAX_DEFAULT + 1e-9
        plain = sample(MEDIUM, s)["video"]
        assert abs(plain["crop_x_end_frac"] - plain["crop_x_frac"]) <= CROP_DRIFT_MAX_DEFAULT + 1e-9
        assert abs(plain["crop_y_end_frac"] - plain["crop_y_frac"]) <= CROP_DRIFT_MAX_DEFAULT + 1e-9


def test_crop_x_end_frac_is_unbudgeted():
    p = sample(MEDIUM, derive_seed(3, 1))
    base = total_distortion(MEDIUM, p)
    bumped = {"video": dict(p["video"])}
    bumped["video"]["crop_x_end_frac"] = 0.0
    bumped["video"]["crop_y_end_frac"] = 1.0
    assert total_distortion(MEDIUM, bumped) == base


def test_crop_travel_has_a_floor_so_the_window_actually_moves():
    """Jeff barely saw the first pan — end can land on start. Force a floor."""
    for s in SEEDS[:200]:
        th = sample(MEDIUM, s, shot="talking_head")["video"]
        assert abs(th["crop_x_end_frac"] - th["crop_x_frac"]) >= 0.08 - 1e-9
        moved = sample(MEDIUM, s, shot="motion")["video"]
        assert abs(moved["crop_x_end_frac"] - moved["crop_x_frac"]) >= 0.10 - 1e-9


def test_handheld_amps_stay_in_band_and_do_not_shift_main_rng():
    seed = derive_seed(11, 5)
    a = sample(MEDIUM, seed, shot="talking_head", width=720, height=1280)
    b = sample(MEDIUM, seed, shot="talking_head", width=720, height=1280)
    va, vb = a["video"], b["video"]
    assert va["trim_end_s"] == vb["trim_end_s"]
    assert va["resample_px"] == vb["resample_px"]
    assert va["crop_hand_amp_x"] == vb["crop_hand_amp_x"]
    assert 0.02 <= va["crop_hand_amp_x"] <= 0.06
    assert 0.005 <= va["crop_hand_amp_y"] <= 0.016
    assert 1.5 <= va["crop_hand_p1"] <= 3.6
    assert va["crop_hand_p2"] > va["crop_hand_p1"]
    y0, y1, ay = va["crop_y_frac"], va["crop_y_end_frac"], va["crop_hand_amp_y"]
    assert y0 - ay >= CROP_Y_KEEP_BOTTOM_LO - 1e-9
    assert y1 + ay <= CROP_Y_KEEP_BOTTOM_HI + 1e-9


def test_ensure_crop_travel():
    assert ensure_crop_travel(0.50, 0.50, 0.35, 0.65, 0.08, 0.24) == pytest.approx(0.58)
    assert ensure_crop_travel(0.62, 0.62, 0.35, 0.65, 0.08, 0.24) == pytest.approx(0.54)
    assert ensure_crop_travel(0.95, 0.95, 0.90, 1.00, 0.06, 0.09) == pytest.approx(1.00)


def test_clamp_crop_drift():
    assert clamp_crop_drift(0.5, 0.55, 0.35, 0.65, 0.12) == pytest.approx(0.55)
    assert clamp_crop_drift(0.5, 0.9, 0.35, 0.65, 0.12) == pytest.approx(0.62)
    assert clamp_crop_drift(0.5, 0.0, 0.35, 0.65, 0.12) == pytest.approx(0.38)
    assert clamp_crop_drift(0.35, 0.65, 0.35, 0.65, 0.12) == pytest.approx(0.47)
    assert clamp_crop_drift(0.65, 0.35, 0.35, 0.65, 0.12) == pytest.approx(0.53)
    assert clamp_crop_drift(0.95, 1.0, 0.90, 1.00, 0.12) == pytest.approx(1.0)
    assert clamp_crop_drift(0.95, 0.80, 0.90, 1.00, 0.12) == pytest.approx(0.90)
    assert clamp_crop_drift(0.5, 0.5, 0.35, 0.65, 0.12) == pytest.approx(0.5)
    assert clamp_crop_drift(0.40, 0.40 + 0.20, 0.35, 0.65, 0.20) == pytest.approx(0.60)


def test_crop_drift_pairs_differ_across_seeds():
    pairs = {
        (
            round(v["crop_x_frac"], 6),
            round(v["crop_x_end_frac"], 6),
            round(v["crop_y_frac"], 6),
            round(v["crop_y_end_frac"], 6),
        )
        for v in (sample(MEDIUM, s)["video"] for s in SEEDS[:80])
    }
    assert len(pairs) > 40


def test_vignette_and_out_fps_use_separate_rng():
    """New axes must not consume the main stream (crop / resample / GOP stay put)."""
    v = sample(MEDIUM, 7)["video"]
    assert v["crop_x_frac"] == pytest.approx(0.3871405883448937)
    assert v["crop_y_frac"] == pytest.approx(0.4169716893821044)
    assert v["trim_end_s"] == pytest.approx(0.36960162784195627)
    assert v["resample_px"] == -30
    assert v["resample_flags"] == "bicubic"
    assert v["gop"] == 90
    assert MEDIUM.vignette.lo <= v["vignette"] <= MEDIUM.vignette.hi
    assert v["out_fps"] in FPS_CHOICES
    assert sample(MEDIUM, 7)["video"]["vignette"] == v["vignette"]
    assert sample(MEDIUM, 7)["video"]["out_fps"] == v["out_fps"]


def test_apply_rotate_safe_uses_their_band():
    assert apply_rotate_safe(0.0, None) == pytest.approx(0.7)
    assert apply_rotate_safe(0.1, "motion") == pytest.approx(0.7)
    assert apply_rotate_safe(-0.2, "motion") == pytest.approx(-0.7)
    assert apply_rotate_safe(2.0, "motion") == pytest.approx(1.3)
    assert apply_rotate_safe(0.1, "talking_head") == pytest.approx(0.35)
    assert apply_rotate_safe(-2.0, "talking_head") == pytest.approx(-0.8)
    assert apply_rotate_safe(0.5, "talking_head") == pytest.approx(0.5)
    assert apply_rotate_safe(0.0, "talking_head", allow_zero=True) == 0.0
