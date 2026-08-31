"""Phase 3. Seed -> budgeted params. PURE & deterministic (unit-tested).

Contract:
  derive_seed(master, index) -> stable per-variant seed
  sample(preset, seed, *, rubberband=False, duration_s=None) -> Params {"video": {...}, "audio": {...}}
    - every axis drawn from preset ranges via a seeded RNG
    - color/geometry axes are ZERO-MEAN (straddle neutral) — no systematic shift
    - transform axes scaled down so total normalized distortion <= preset.budget
    - audio.speed MUST equal video.speed (sync); pitch only if rubberband AND audio_uniqueness
  total_distortion(preset, params) -> the normalized distortion these params spend

The distortion model is the budget contract: each budgeted axis contributes a value in
[0, 1] measuring how far it strays from its calm point, relative to its in-range reach.
When the raw draw overspends, sample() shrinks ENCODE axes (grain/unsharp/crf) toward
calm first so per-copy color can still show. crop_keep and rebuild_scale are unbudgeted
(VMAF already ignores both). warp_k1 is budgeted again so the quality loop can cap it —
unbudgeted warp on talking-head scored VMAF 53–80 and dropped Drive uploads.
Color stays zero-mean; bounds stay intact.
"""
from __future__ import annotations

import hashlib
import random
from dataclasses import replace

from .presets import Preset, Range
from .shot import (
    chroma_cloud_range_for_shot,
    crop_keep_range_for_shot,
    grain_range_for_shot,
    keeps_bottom_captions,
    luma_dust_range_for_shot,
    rebuild_range_for_shot,
)

# Keep at least this much of a short clip after head+tail trim (ffmpeg needs remaining > 0).
_MIN_REMAINING_S = 0.05
_REMAINING_FRACTION = 0.5
_REMAINING_CAP_S = 1.0

# Axis model. kind "sym" => zero-mean around `ref` (a neutral value); kind "dir" => one-
# directional, calm at the range end named by `ref` ("lo" or "hi"). `budgeted` axes share
# the per-variant distortion budget; temporal axes (speed, trim) ride along unbudgeted.
# crop_keep and rebuild_scale are unbudgeted: vs-source uniqueness levers. VMAF
# already ignores both (quality proxy is platform=none + identity rebuild).
# warp_k1 is budgeted so VMAF regen can shrink it; unbudgeted warp wrote
# best_effort files that harvest skipped.
_SYM, _DIR = "sym", "dir"
_VIDEO_AXES = (
    # (name,           kind,  ref,    budgeted)
    ("crop_keep",      _DIR,  "hi",   False),
    ("rebuild_scale",  _DIR,  "hi",   False),  # reconstructive round-trip; 1.0 = skip
    ("rotate_deg",     _SYM,  0.0,    True),
    ("brightness",     _SYM,  0.0,    True),
    ("contrast",       _SYM,  1.0,    True),
    ("saturation",     _SYM,  1.0,    True),
    ("gamma",          _SYM,  1.0,    True),
    ("hue_deg",        _SYM,  0.0,    True),
    ("grain",          _DIR,  "lo",   True),
    ("unsharp",        _DIR,  "lo",   True),
    ("crf",            _DIR,  "lo",   True),   # encoder degradation counts toward the budget
    ("warp_k1",        _SYM,  0.0,    True),   # VMAF-capped pixel seed
    ("speed",          _SYM,  1.0,    False),  # temporal identity ops ride along unbudgeted
    ("trim_s",         _DIR,  "lo",   False),
)
# crf is output as an int (floored toward its calm 'lo' end, so its budget share never grows).
_INT_AXES = frozenset({"crf"})
# Over-budget shrink: collapse cheap-look encode first so color still shows.
_ENCODE_AXES = frozenset({"grain", "unsharp", "crf"})
_LOOK_AXES = frozenset({
    "rotate_deg",
    "brightness", "contrast", "saturation", "gamma", "hue_deg",
    "warp_k1",
})
# Back-compat alias used by older tests/docs: encode + color (not geometry).
_COLOR_ENCODE_AXES = _ENCODE_AXES | frozenset({
    "brightness", "contrast", "saturation", "gamma", "hue_deg",
})
_GEOMETRY_AXES = frozenset({"crop_keep", "rotate_deg", "warp_k1", "rebuild_scale"})

# Caption-safe crop window on 1080. 0..1 slides the leftover onto one edge
# and clips burned-in words (live pack ced7cbec7c49 copy 1: keep 0.84, x=0.90,
# y=0.14). Stay near center; still zero-mean at 0.5. Unbudgeted fingerprint.
CROP_OFFSET_LO = 0.35
CROP_OFFSET_HI = 0.65
# Instagram 720: leftover is taken from the TOP (y→1.0) so the bottom caption
# band stays. Centered y on 720 scored 20 bits — below the gate — and also ate
# words when y drifted low. Unbudgeted; not zero-mean (that is the point).
CROP_Y_KEEP_BOTTOM_LO = 0.90
CROP_Y_KEEP_BOTTOM_HI = 1.00
# Micro start→end crop-window travel + handheld wander. Unbudgeted; separate RNG.
# v1 max was 0.12 / 0.20 — Jeff barely saw it. Floor so the window always moves.
CROP_DRIFT_MAX_TALKING_HEAD = 0.24
CROP_DRIFT_MAX_DEFAULT = 0.28
CROP_TRAVEL_MIN_TALKING_HEAD = 0.08
CROP_TRAVEL_MIN_DEFAULT = 0.10
CROP_HAND_AMP_X_TALKING = (0.020, 0.060)
CROP_HAND_AMP_Y_TALKING = (0.005, 0.016)
CROP_HAND_AMP_X_DEFAULT = (0.028, 0.070)
CROP_HAND_AMP_Y_DEFAULT = (0.010, 0.028)
CROP_HAND_P1 = (1.5, 3.6)
_CROP_DRIFT_RNG_XOR = 0xC0DE5

# Unbudgeted Fast pixel seed: even px off target width, never 0, never a 2px peek.
# Mix of smaller and larger intermediates so we do not systematically soften one way.
RESAMPLE_PX_CHOICES = tuple(x for x in range(-32, 33, 2) if abs(x) >= 8)
RESAMPLE_FLAGS = ("lanczos", "spline", "bicubic")
# Per-copy output cadence. Instagram takes these. Not a second speed factor.
FPS_CHOICES = (30, 48, 60)
_EXTRA_AXES_XOR = 0xF95
_ROTATE_SAFE_MOTION = (0.7, 1.3)
_ROTATE_SAFE_HEAD = (0.35, 0.8)


def apply_rotate_safe(deg: float, shot: str | None, *, allow_zero: bool = False) -> float:
    """Keep rotate on. Motion matches the 0.7–1.3 band; talking-head stays subtler."""
    value = float(deg)
    if allow_zero and abs(value) < 1e-12:
        return 0.0
    lo, hi = _ROTATE_SAFE_HEAD if shot == "talking_head" else _ROTATE_SAFE_MOTION
    sign = -1.0 if value < 0 else 1.0
    mag = min(hi, max(abs(value), lo))
    return sign * mag


def derive_seed(master_seed: int, index: int) -> int:
    """Deterministic per-variant seed."""
    h = hashlib.sha256(f"{master_seed}:{index}".encode()).digest()
    return int.from_bytes(h[:8], "big")


def _calm_point(kind, ref, lo: float, hi: float) -> float:
    """The least-distorting value of an axis within its range."""
    if kind == _SYM:
        return ref
    return hi if ref == "hi" else lo


def _reach(kind, ref, lo: float, hi: float) -> float:
    """Normalizing span: tightest symmetric half-width (sym) or full width (dir)."""
    if kind == _SYM:
        return min(ref - lo, hi - ref)
    return hi - lo


def _axis_distortion(kind, ref, lo: float, hi: float, value: float) -> float:
    reach = _reach(kind, ref, lo, hi)
    if reach <= 0:
        return 0.0
    return abs(value - _calm_point(kind, ref, lo, hi)) / reach


def _spent_on(raw: dict[str, float], preset: Preset, names: frozenset[str]) -> float:
    total = 0.0
    for name, kind, ref, budgeted in _VIDEO_AXES:
        if not budgeted or name not in names:
            continue
        r = getattr(preset, name)
        total += _axis_distortion(kind, ref, r.lo, r.hi, raw[name])
    return total


def _shrink_toward_calm(
    raw: dict[str, float], preset: Preset, names: frozenset[str], factor: float,
) -> None:
    """Scale named axes toward their calm point. factor=0 collapses to calm; 1 keeps raw."""
    for name, kind, ref, budgeted in _VIDEO_AXES:
        if not budgeted or name not in names:
            continue
        r = getattr(preset, name)
        calm = _calm_point(kind, ref, r.lo, r.hi)
        raw[name] = calm + factor * (raw[name] - calm)


def total_distortion(preset: Preset, params: dict) -> float:
    """Sum of normalized distortion across budgeted axes (the budget metric)."""
    v = params["video"]
    total = 0.0
    for name, kind, ref, budgeted in _VIDEO_AXES:
        if not budgeted:
            continue
        r = getattr(preset, name)
        total += _axis_distortion(kind, ref, r.lo, r.hi, v[name])
    return total


def clamp_crop_drift(start: float, end: float, lo: float, hi: float, max_delta: float) -> float:
    """Clamp end into [lo,hi] and within max_delta of start."""
    lower = max(lo, start - max_delta)
    upper = min(hi, start + max_delta)
    if lower > upper:
        return min(max(start, lo), hi)
    return min(max(end, lower), upper)


def ensure_crop_travel(
    start: float,
    end: float,
    lo: float,
    hi: float,
    min_delta: float,
    max_delta: float,
) -> float:
    """Push `end` at least `min_delta` from `start`, staying in band and max_delta.

    Prefer the already-drawn direction (or up, when end landed on start). If
    that side cannot fit the floor, try the other side; if neither can, travel
    as far as the band/max allow (720 y is only 0.10 wide).
    """
    start = float(start)
    end = clamp_crop_drift(start, float(end), lo, hi, max_delta)
    if min_delta <= 0:
        return end
    if abs(end - start) + 1e-12 >= min_delta:
        return end
    up_room = min(hi - start, max_delta)
    down_room = min(start - lo, max_delta)
    hint = end - start

    def _go_up() -> float | None:
        if up_room + 1e-12 >= min_delta:
            return start + min_delta
        return None

    def _go_down() -> float | None:
        if down_room + 1e-12 >= min_delta:
            return start - min_delta
        return None

    if abs(hint) < 1e-12 or hint > 0:
        picked = _go_up() or _go_down()
        if picked is not None:
            return picked
        return start + up_room if up_room >= down_room else start - down_room
    picked = _go_down() or _go_up()
    if picked is not None:
        return picked
    return start - down_room if down_room >= up_room else start + up_room


def clamp_trims(trim_s: float, trim_end_s: float, duration_s: float) -> tuple[float, float]:
    """Scale head/tail trims so a short clip keeps a usable remaining duration.

    Fingerprint trims are drawn from preset ranges that assume a typical social clip.
    On a 1s source, STRONG's 0.30–0.85s per end would otherwise consume the whole file.
    Long clips are unchanged: the cap only fires when start+end would leave less than
    max(50ms, half the duration), capped at 1s remaining.
    """
    start = max(0.0, float(trim_s))
    end = max(0.0, float(trim_end_s))
    if duration_s <= 0:
        return 0.0, 0.0
    remaining_floor = min(
        _REMAINING_CAP_S,
        max(_MIN_REMAINING_S, duration_s * _REMAINING_FRACTION),
        duration_s,
    )
    budget = max(0.0, duration_s - remaining_floor)
    total = start + end
    if total > budget and total > 0:
        scale = budget / total
        start *= scale
        end *= scale
    start = min(start, budget)
    end = min(end, max(0.0, duration_s - start - remaining_floor))
    return round(start, 4), round(end, 4)


def clamp_strength(strength: float) -> float:
    """Clamp `strength` to the range `sample()` honors.

    Capped at 2.0 (not 1.0): the uniqueness ladder escalates strength ABOVE 1.0 (e.g.
    1.0 -> 1.25 -> 1.5) to spend more of the budget on later rungs, and that only does
    anything if values above 1.0 are distinct from 1.0. Callers (e.g. pipeline.py) should
    use this to compute the EFFECTIVE strength before calling `sample`, so whatever they
    record as "the strength actually applied" matches what `sample` really used.
    """
    return min(2.0, max(0.0, strength))


def _remap_range(value: float, src: Range, dst: Range) -> float:
    """Map ``value`` from ``src`` onto ``dst`` (same seed position, new band)."""
    if src.lo == dst.lo and src.hi == dst.hi:
        return value
    span = src.hi - src.lo
    if span <= 0:
        return dst.lo
    t = min(1.0, max(0.0, (value - src.lo) / span))
    return dst.lo + t * (dst.hi - dst.lo)


def disable_fast_pixel_ops(params: dict) -> dict:
    """HQ skip: ESRGAN already rebuilds pixels. Zeros resample/rebuild/warp, keeps the rest."""
    video = dict(params["video"])
    video["resample_px"] = 0
    video["rebuild_scale"] = 1.0
    video["warp_k1"] = 0.0
    video["luma_shade"] = 0.0
    return {**params, "video": video}


def sample(
    preset: Preset,
    seed: int,
    *,
    rubberband: bool = False,
    strength: float = 1.0,
    duration_s: float | None = None,
    shot: str | None = None,
    width: int | None = None,
    height: int | None = None,
    audio_uniqueness: bool = False,
) -> dict:
    """Draw budgeted, zero-mean params for one variant.

    `strength` in [0, 2] is the lever the auto-tune controller / quality guard drives: it
    caps total distortion at `strength * preset.budget`. 1.0 spends the full budget; values
    above 1.0 push past the preset's nominal budget (used by the uniqueness ladder to make
    escalating rungs actually distinct); lower values yield gentler variants. The seed fixes
    WHICH axes move; strength fixes how far. `duration_s` (when given) scales head/tail
    trim so a short source keeps a usable remaining duration.     `shot` is a look-first
    hint (`talking_head` / `motion`); None keeps the preset rebuild band so seeds match.
    ``width`` / ``height`` select the Instagram-720 crop (punch from the top).
    Omitted size keeps the 1080 caption-safe center band so seeds match.
    """
    strength = clamp_strength(strength)
    budget = preset.budget * strength
    rng = random.Random(seed)

    # Draw every continuous axis in a fixed order (order anchors reproducibility).
    raw: dict[str, float] = {}
    for name, kind, ref, _budgeted in _VIDEO_AXES:
        r = getattr(preset, name)
        if kind == _SYM:
            d = min(ref - r.lo, r.hi - ref)
            raw[name] = ref + rng.uniform(-d, d)
        else:
            raw[name] = rng.uniform(r.lo, r.hi)

    raw["rebuild_scale"] = _remap_range(
        raw["rebuild_scale"], preset.rebuild_scale, rebuild_range_for_shot(preset, shot),
    )
    keep_r = crop_keep_range_for_shot(preset, shot, width, height)
    if keep_r is not None:
        raw["crop_keep"] = _remap_range(raw["crop_keep"], preset.crop_keep, keep_r)
    work = preset
    shot_grain = grain_range_for_shot(preset, shot)
    if shot_grain is not None:
        # Remap onto the shot band, then budget/VMAF shrink toward *shot.lo*
        # (not preset.lo). Luma grain 40–52 scored 55–65% uniqueness but VMAF
        # ~80 and best_effort — harvest skipped those files. Chroma-only noise
        # is the uniqueness lever (no extra RNG). Shrink must still be able to
        # walk grain down so the quality guard can fire.
        raw["grain"] = _remap_range(raw["grain"], preset.grain, shot_grain)
        work = replace(preset, grain=shot_grain)
        raw["noise_chroma"] = True
        # ffmpeg noise seed defaults to -1 (same pattern on every copy). Derive
        # from the variant seed — no extra RNG — so peers disagree at 576.
        raw["noise_seed"] = int(seed) & 0x7FFFFFFF

    # Fit the budget: shrink grain/unsharp/crf first so color shows.
    # crop_keep and rebuild_scale are unbudgeted fingerprints — strength must
    # not pull keep to 1.0 or rebuild to identity. Warp shrinks with look.
    spent = _spent_on(raw, work, _ENCODE_AXES | _LOOK_AXES)
    if spent > budget and spent > 0:
        look_spent = _spent_on(raw, work, _LOOK_AXES)
        leftover = budget - look_spent
        enc = _ENCODE_AXES
        if shot_grain is not None:
            # Uniqueness grain is the talking-head lever; don't collapse it to
            # shot.lo just because color/warp already spent the look budget.
            enc = _ENCODE_AXES - {"grain"}
        if leftover >= 0:
            enc_spent = _spent_on(raw, work, enc)
            if enc_spent > 0:
                _shrink_toward_calm(raw, work, enc, leftover / enc_spent)
        else:
            _shrink_toward_calm(raw, work, enc, 0.0)
            look_spent = _spent_on(raw, work, _LOOK_AXES)
            if look_spent > 0:
                _shrink_toward_calm(raw, work, _LOOK_AXES, budget / look_spent)

    if shot_grain is not None:
        cloud_r = chroma_cloud_range_for_shot(preset, shot, width, height)
        if cloud_r is not None:
            # Remap from the (possibly shrunk) grain — no extra RNG.
            raw["chroma_cloud"] = _remap_range(raw["grain"], shot_grain, cloud_r)
        dust_r = luma_dust_range_for_shot(preset, shot, width, height)
        if dust_r is not None:
            raw["luma_dust"] = _remap_range(raw["grain"], shot_grain, dust_r)

    # Fingerprint-only geometry axes: unbudgeted (never count toward distortion), drawn
    # independently of the shrink step above so a full-strength crop offset never eats
    # into the quality budget. 1080 x/y stay in a center band (zero-mean at 0.5).
    # Instagram 720 takes leftover from the top so burned-in words survive AND
    # vs-source bits can clear 24. trim_end_s reuses the preset's trim_s range.
    raw["crop_x_frac"] = rng.uniform(CROP_OFFSET_LO, CROP_OFFSET_HI)
    if keeps_bottom_captions(width, height):
        y_lo, y_hi = CROP_Y_KEEP_BOTTOM_LO, CROP_Y_KEEP_BOTTOM_HI
    else:
        y_lo, y_hi = CROP_OFFSET_LO, CROP_OFFSET_HI
    raw["crop_y_frac"] = rng.uniform(y_lo, y_hi)
    # Keyframed crop pan + handheld wander: separate RNG so trim_end_s /
    # resample_px / vignette / out_fps stay bit-identical.
    talking = shot == "talking_head"
    max_delta = CROP_DRIFT_MAX_TALKING_HEAD if talking else CROP_DRIFT_MAX_DEFAULT
    min_dx = CROP_TRAVEL_MIN_TALKING_HEAD if talking else CROP_TRAVEL_MIN_DEFAULT
    drift_rng = random.Random(int(seed) ^ _CROP_DRIFT_RNG_XOR)
    raw["crop_x_end_frac"] = ensure_crop_travel(
        raw["crop_x_frac"],
        drift_rng.uniform(CROP_OFFSET_LO, CROP_OFFSET_HI),
        CROP_OFFSET_LO,
        CROP_OFFSET_HI,
        min_dx,
        max_delta,
    )
    raw["crop_y_end_frac"] = clamp_crop_drift(
        raw["crop_y_frac"],
        drift_rng.uniform(y_lo, y_hi),
        y_lo,
        y_hi,
        max_delta,
    )
    if talking:
        amp_x_lo, amp_x_hi = CROP_HAND_AMP_X_TALKING
        amp_y_lo, amp_y_hi = CROP_HAND_AMP_Y_TALKING
    else:
        amp_x_lo, amp_x_hi = CROP_HAND_AMP_X_DEFAULT
        amp_y_lo, amp_y_hi = CROP_HAND_AMP_Y_DEFAULT
    raw["crop_hand_amp_x"] = drift_rng.uniform(amp_x_lo, amp_x_hi)
    raw["crop_hand_amp_y"] = drift_rng.uniform(amp_y_lo, amp_y_hi)
    raw["crop_hand_p1"] = drift_rng.uniform(CROP_HAND_P1[0], CROP_HAND_P1[1])
    raw["crop_hand_p2"] = drift_rng.uniform(
        raw["crop_hand_p1"] + 0.8, raw["crop_hand_p1"] + 3.4,
    )
    # 720 caption band is 0.10 wide: keep start/end ± amp inside 0.90–1.00.
    if keeps_bottom_captions(width, height):
        ay = raw["crop_hand_amp_y"]
        inner_lo = y_lo + ay
        inner_hi = y_hi - ay
        if inner_lo <= inner_hi:
            raw["crop_y_frac"] = min(max(raw["crop_y_frac"], inner_lo), inner_hi)
            raw["crop_y_end_frac"] = min(max(raw["crop_y_end_frac"], inner_lo), inner_hi)
    raw["trim_end_s"] = rng.uniform(preset.trim_s.lo, preset.trim_s.hi)
    raw["resample_px"] = rng.choice(RESAMPLE_PX_CHOICES)
    raw["resample_flags"] = rng.choice(RESAMPLE_FLAGS)
    if duration_s is not None:
        raw["trim_s"], raw["trim_end_s"] = clamp_trims(
            raw["trim_s"], raw["trim_end_s"], duration_s,
        )

    gop = rng.choice(preset.gop_choices)

    video = dict(raw)
    # Floor int axes toward their calm 'lo' end so the rounded value never exceeds its
    # budgeted share (keeps total_distortion(params) <= budget a hard guarantee).
    for name in _INT_AXES:
        video[name] = int(video[name])
    video["gop"] = gop
    extra = random.Random(int(seed) ^ _EXTRA_AXES_XOR)
    video["vignette"] = extra.uniform(preset.vignette.lo, preset.vignette.hi)
    video["out_fps"] = extra.choice(FPS_CHOICES)

    # Audio mirrors the single speed factor. Voice-safe default: no pitch / EQ /
    # loudnorm (those make talking sound robotic). audio_uniqueness is the later
    # "audio trends" switch.
    if audio_uniqueness:
        eq_d = min(0.0 - preset.eq_gain_db.lo, preset.eq_gain_db.hi - 0.0)
        eq_gains = [rng.uniform(-eq_d, eq_d) for _ in range(preset.eq_bands)]
        loudnorm_i = rng.uniform(preset.loudnorm_i.lo, preset.loudnorm_i.hi)
        aac_kbps = int(round(rng.uniform(preset.aac_kbps.lo, preset.aac_kbps.hi)))
        if rubberband:
            p_d = min(0.0 - preset.pitch_pct.lo, preset.pitch_pct.hi - 0.0)
            pitch_pct = rng.uniform(-p_d, p_d)
        else:
            pitch_pct = 0.0
        audio = {
            "speed": video["speed"],  # invariant 3: one speed factor on both streams
            "loudnorm_i": loudnorm_i,
            "eq_bands": preset.eq_bands,
            "eq_gains": eq_gains,
            "pitch_pct": pitch_pct,
            "aac_kbps": aac_kbps,
        }
    else:
        audio = {
            "speed": video["speed"],
            "loudnorm_i": None,
            "eq_bands": preset.eq_bands,
            "eq_gains": [0.0] * preset.eq_bands,
            "pitch_pct": 0.0,
            "aac_kbps": int(preset.aac_kbps.hi),
        }

    return {"video": video, "audio": audio}
