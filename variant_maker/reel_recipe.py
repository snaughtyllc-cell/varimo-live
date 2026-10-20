"""Fixed Reel copy table.

Ten rows repeat. Copy 11 is row 1 again plus a small hue step. Pitch and the
opening-frame nudge each take a distinct value for the first 200 copies.
Speed stays on the row (0.95×–1.05×). One sharpen amount is shared by every
copy. Grain, tilt, wander, and a second preset are not part of this table.
"""
from __future__ import annotations

from .sampler import clamp_trims

# speed, zoom, hue degrees, saturation, start trim s, end trim s, crf
_ROWS: tuple[tuple[float, float, float, float, float, float, int], ...] = (
    (1.00, 1.00, 0.0, 1.00, 0.00, 0.00, 18),
    (1.03, 1.01, 2.0, 1.02, 0.30, 0.00, 18),
    (0.97, 1.02, -2.0, 0.98, 0.10, 0.30, 19),
    (1.05, 1.01, 3.0, 1.03, 0.50, 0.00, 18),
    (0.95, 1.02, -3.0, 0.97, 0.00, 0.50, 19),
    (1.02, 1.00, 1.0, 1.01, 0.20, 0.20, 18),
    (0.98, 1.01, -1.0, 0.99, 0.40, 0.10, 19),
    (1.04, 1.02, 2.0, 0.98, 0.10, 0.40, 18),
    (0.96, 1.01, -2.0, 1.02, 0.30, 0.20, 19),
    (1.01, 1.03, 3.0, 0.97, 0.50, 0.50, 18),
)

PITCH_SLOTS = 200
PITCH_PCT = 1.5
HUE_PER_CYCLE = 0.2
COVER_WINDOW_S = 0.5
UNSHARP = 0.30
GOP = 60
OUT_FPS = 30
AAC_KBPS = 192


def params_for_copy(
    copy_number: int,
    *,
    duration_s: float | None = None,
    rubberband: bool = False,
) -> dict:
    """Params for 1-based copy_number. Same number always returns the same params."""
    n = int(copy_number)
    if n < 1:
        raise ValueError("copy_number starts at 1")
    speed, zoom, hue, saturation, trim_s, trim_end, crf = _ROWS[(n - 1) % len(_ROWS)]
    cycle = (n - 1) // len(_ROWS)
    slot = (n - 1) % PITCH_SLOTS
    hue = hue + cycle * HUE_PER_CYCLE
    if PITCH_SLOTS == 1:
        pitch = 0.0
    else:
        pitch = -PITCH_PCT + slot * (2 * PITCH_PCT / (PITCH_SLOTS - 1))
    if not rubberband:
        pitch = 0.0
    trim_s = trim_s + slot * (COVER_WINDOW_S / (PITCH_SLOTS - 1))
    if duration_s is not None:
        trim_s, trim_end = clamp_trims(trim_s, trim_end, duration_s)
    keep = 1.0 / zoom
    video = {
        "copy_number": n,
        "speed": speed,
        "crop_keep": keep,
        "crop_x_frac": 0.5,
        "crop_y_frac": 0.5,
        "crop_hand_amp_x": 0.0,
        "crop_hand_amp_y": 0.0,
        "rotate_deg": 0.0,
        "brightness": 0.0,
        "contrast": 1.0,
        "saturation": saturation,
        "gamma": 1.0,
        "hue_deg": hue,
        "grain": 0.0,
        "noise_chroma": False,
        "chroma_cloud": 0.0,
        "luma_dust": 0.0,
        "unsharp": UNSHARP,
        "warp_k1": 0.0,
        "rebuild_scale": 1.0,
        "resample_px": 0,
        "vignette": 0.0,
        "keystone_a": 0.0,
        "trim_s": trim_s,
        "trim_end_s": trim_end,
        "crf": int(crf),
        "gop": GOP,
        "out_fps": OUT_FPS,
    }
    audio = {
        "speed": speed,
        "loudnorm_i": None,
        "eq_bands": 0,
        "eq_gains": [],
        "pitch_pct": pitch,
        "aac_kbps": AAC_KBPS,
    }
    return {"video": video, "audio": audio}
