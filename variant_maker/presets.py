"""Preset range tables (data, not logic) + the per-variant distortion budget.

Color shifts are ZERO-MEAN (a (lo, hi) range straddling neutral) so we never
systematically desaturate/darken — that systematic degradation IS the cheap look.
The sampler draws each axis from these ranges, then scales them down to fit `budget`.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Range:
    lo: float
    hi: float


@dataclass(frozen=True)
class Preset:
    name: str
    budget: float  # total normalized distortion allowed across all axes (0..1 per axis)
    # video (zero-mean unless noted)
    crop_keep: Range
    rotate_deg: Range
    brightness: Range
    contrast: Range
    saturation: Range
    gamma: Range
    hue_deg: Range
    vignette: Range  # edge darken; 0 = skip; unbudgeted fingerprint
    grain: Range
    unsharp: Range
    warp_k1: Range  # Fast pixel seed (lenscorrection); zero-mean; VMAF-capped
    rebuild_scale: Range  # Fast reconstructive round-trip; 1.0 = skip; unbudgeted
    speed: Range
    trim_s: Range
    crf: Range
    gop_choices: tuple[int, ...]
    # audio
    loudnorm_i: Range
    eq_gain_db: Range
    eq_bands: int
    pitch_pct: Range  # 0 unless rubberband available
    aac_kbps: Range


SUBTLE = Preset(
    name="subtle", budget=0.35,
    crop_keep=Range(0.98, 1.00), rotate_deg=Range(0.0, 0.0),
    brightness=Range(-0.01, 0.01), contrast=Range(0.99, 1.01),
    saturation=Range(0.99, 1.02), gamma=Range(0.99, 1.01),     hue_deg=Range(-1, 1),
    vignette=Range(0.0, 0.04),
    grain=Range(3, 6), unsharp=Range(0.0, 0.0), warp_k1=Range(-0.004, 0.004),
    rebuild_scale=Range(0.90, 0.98),
    speed=Range(0.99, 1.01),
    trim_s=Range(0.0, 0.10), crf=Range(18, 20), gop_choices=(48, 60),
    loudnorm_i=Range(-14, -14), eq_gain_db=Range(-1, 1), eq_bands=1,
    pitch_pct=Range(0.0, 0.0), aac_kbps=Range(160, 160),
)

MEDIUM = Preset(
    name="medium", budget=0.65,
    # Talking-head keep=0.72 (face-only zoom) scored *worse* SSIM bits than 0.858.
    # 0.84–0.90 with a 0..1 window cropped a burned-in word (ced7cbec7c49).
    # 0.92–0.96 is a 4–8% punch — uniqueness still clears 24; captions stay in.
    crop_keep=Range(0.92, 0.96), rotate_deg=Range(-0.8, 0.8),
    brightness=Range(-0.025, 0.025), contrast=Range(0.97, 1.03),
    saturation=Range(0.96, 1.05), gamma=Range(0.97, 1.03),     hue_deg=Range(-3, 3),
    vignette=Range(0.02, 0.12),
    grain=Range(7, 12), unsharp=Range(0.2, 0.35), warp_k1=Range(-0.015, 0.015),
    # ~720–864 then back to 1080×1920. The uniqueness frame (576×1024) can see this;
    # ±32 px could not. Escalate's strong.hi sits below medium.lo.
    rebuild_scale=Range(0.67, 0.80),
    speed=Range(0.96, 1.04),
    trim_s=Range(0.15, 0.50), crf=Range(19, 22), gop_choices=(48, 60, 90),
    loudnorm_i=Range(-15, -13), eq_gain_db=Range(-2, 2), eq_bands=2,
    pitch_pct=Range(-2.0, 2.0), aac_kbps=Range(128, 192),
)

STRONG = Preset(
    name="strong", budget=0.90,
    # Escalate punches a bit harder than medium, not into face-only zoom. Grain is
    # uniqueness texture; social 12M cap is the file-size ceiling (not grain=4).
    crop_keep=Range(0.88, 0.93), rotate_deg=Range(-2.0, 2.0),
    brightness=Range(-0.04, 0.04), contrast=Range(0.95, 1.06),
    saturation=Range(0.92, 1.10), gamma=Range(0.95, 1.05),     hue_deg=Range(-6, 6),
    vignette=Range(0.04, 0.20),
    grain=Range(10, 16), unsharp=Range(0.3, 0.45), warp_k1=Range(-0.020, 0.020),
    rebuild_scale=Range(0.50, 0.66),
    speed=Range(0.94, 1.06),
    trim_s=Range(0.30, 0.85), crf=Range(20, 23), gop_choices=(60, 90, 120),
    loudnorm_i=Range(-16, -13), eq_gain_db=Range(-3, 3), eq_bands=2,
    pitch_pct=Range(-4.0, 4.0), aac_kbps=Range(128, 192),
)

PRESETS = {p.name: p for p in (SUBTLE, MEDIUM, STRONG)}


def get_preset(name: str) -> Preset:
    try:
        return PRESETS[name]
    except KeyError:
        raise ValueError(f"unknown preset {name!r}; choose from {sorted(PRESETS)}")
