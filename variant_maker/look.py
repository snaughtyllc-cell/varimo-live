"""Look-first visual gate. Runs on the *actual* output, not the VMAF proxy.

VMAF `quality_render` strips fingerprint ops (crop, shade, …) so frames align.
Uniqueness SSIM *wants* difference. Lab pack `lookaqmtp` scored VMAF 97–99 and
33–34 bits and still looked like lava on the face. This metric is coarse luma
MAE at 16×28 — the scale of cookie / lighting overlays.

Calibration 2026-08-25 (16×28, 8-bit MAE):

| Pair | MAE |
|---|---|
| Identity | 0 |
| AQMTp signed medium | 12–32 |
| SaveInta signed medium | 20–32 |
| lookaqmtp shade 100 (8×14, gblur 10) | 41–57 |

Gate **38**. One blotchy sample fails. Missing files / ffmpeg errors →
`unknown` (do not block uniqueness). Log: `docs/ops/look-learnings.md`.

Stills: zscale bt709/tv → sRGB, not a naked `scale=360` (that olives Gallery
JPEGs). MAE: accurate frame times (60fps vs 48fps keyframe-seek was NEW-bradnded
MAE 119) and crop-align the source window so caption punch-in is not lava.
"""
from __future__ import annotations

import os
import subprocess

from . import uniqueness
from .sampler import clamp_trims

LOOK_METRIC = "coarse_luma_v1"
LOOK_GRID = (16, 28)
# 8-bit mean absolute error on the coarse grid. Signed 720 medium landed ≤32;
# rejected shade was ≥41. Do not raise this to "pass" a blotchy overlay.
LOOK_LUMA_MAX = 38.0
FRAME_FRACS = uniqueness.FRAME_FRACS
STILL_WIDTH = 360
_EPS = 1e-6
# Gallery stills: tagged HD → sRGB. Naked scale=360 is a 601-ish JPEG path.
_STILL_ZSCALE = (
    "zscale=matrixin=709:transferin=709:primariesin=709:rangein=limited:"
    "matrix=709:transfer=iec61966-2-1:primaries=bt709:range=full"
)


def look_src_name(index: int) -> str:
    return f"look_v{int(index):02d}_src.jpg"


def look_var_name(index: int) -> str:
    return f"look_v{int(index):02d}.jpg"


def still_vf() -> str:
    """Color-correct 360px JPEG extract. Even height for the encoder."""
    return (
        f"{_STILL_ZSCALE},format=rgb24,"
        f"scale={STILL_WIDTH}:-2:flags=lanczos,"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2"
    )


def _probe_duration(path: str) -> float:
    return uniqueness._probe_duration(path)


def _clamp_t(t: float, duration_s: float) -> float:
    if duration_s <= 0.1:
        return 0.0
    return min(max(0.0, float(t)), max(duration_s - 0.05, 0.0))


def _crop_prefix(video: dict | None) -> str:
    """Static start-window crop on the *source* so MAE sees the variant window.

    Handheld / start→end drift is a t-expr; a single -ss still cannot follow it.
    Use crop_keep + crop_x_frac + crop_y_frac (the encode's opening punch-in).
    """
    if not video:
        return ""
    keep = float(video.get("crop_keep") or 1.0)
    if keep >= 1.0 - _EPS:
        return ""
    x0 = float(video.get("crop_x_frac", 0.5))
    y0 = float(video.get("crop_y_frac", 0.5))
    return (
        f"crop=iw*{keep:.4f}:ih*{keep:.4f}:"
        f"(iw-iw*{keep:.4f})*{x0:.4f}:(ih-ih*{keep:.4f})*{y0:.4f},"
    )


def _sample_times(
    src_dur: float, var_dur: float, video: dict | None,
) -> list[tuple[float, float]]:
    """(t_src, t_var) at FRAME_FRACS. Map trim/speed when those params exist."""
    video = video or {}
    trim_s = float(video.get("trim_s") or 0.0)
    trim_end = float(video.get("trim_end_s") or 0.0)
    speed = float(video.get("speed") or 1.0) or 1.0
    start_s, end_s = clamp_trims(trim_s, trim_end, src_dur)
    has_time = start_s > _EPS or end_s > _EPS or abs(speed - 1.0) > _EPS
    remaining = max(src_dur - start_s - end_s, 0.1)
    out: list[tuple[float, float]] = []
    for frac in FRAME_FRACS:
        if has_time:
            t_src = start_s + frac * remaining
            t_var = (t_src - start_s) / speed
        else:
            t_src = frac * src_dur
            t_var = frac * var_dur
        out.append((_clamp_t(t_src, src_dur), _clamp_t(t_var, var_dur)))
    return out


def _coarse_luma_mae(
    path_a: str, t_a: float, path_b: str, t_b: float,
    *, crop_a: str = "",
) -> float:
    """8-bit MAE of luma after area-scale to LOOK_GRID. 0 = identical.

    Decode via trim= (accurate timestamps). Input -ss is keyframe-only and
    scored NEW-bradnded ~125 when source was 60fps and the variant 48fps.
    """
    gw, gh = LOOK_GRID
    vf = (
        f"[0:v]trim=start={t_a:.6f},setpts=PTS-STARTPTS,{crop_a}"
        f"scale={gw}:{gh}:flags=area,format=gray[a];"
        f"[1:v]trim=start={t_b:.6f},setpts=PTS-STARTPTS,"
        f"scale={gw}:{gh}:flags=area,format=gray[b];"
        f"[a][b]blend=all_mode=difference,format=gray,scale=1:1:flags=area,format=gray"
    )
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-i", path_a, "-i", path_b,
            "-filter_complex", vf,
            "-frames:v", "1",
            "-f", "rawvideo", "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    if not proc.stdout:
        raise ValueError("empty coarse-luma pipe")
    return float(proc.stdout[0])


def _extract_jpeg(path: str, t: float, out_path: str) -> None:
    if os.path.exists(out_path):
        os.remove(out_path)
    # -ss after -i is accurate (output seek). Gallery stills must match the mp4.
    subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-i", path,
            "-ss", f"{max(0.0, t):.6f}",
            "-frames:v", "1",
            "-vf", still_vf(),
            "-q:v", "3",
            "-y", out_path,
        ],
        check=True,
        capture_output=True,
    )
    if not os.path.isfile(out_path) or os.path.getsize(out_path) <= 0:
        raise ValueError(f"empty look still {out_path}")


def write_look_stills(
    src_path: str, variant_path: str, out_dir: str, index: int,
) -> dict[str, str]:
    """Mid-frame source vs variant JPEGs for Studio / CLI. Returns basenames."""
    os.makedirs(out_dir, exist_ok=True)
    src_name = look_src_name(index)
    var_name = look_var_name(index)
    src_jpg = os.path.join(out_dir, src_name)
    var_jpg = os.path.join(out_dir, var_name)
    dur_a = max(_probe_duration(src_path), 0.1)
    dur_b = max(_probe_duration(variant_path), 0.1)
    t = 0.5
    _extract_jpeg(src_path, t * dur_a, src_jpg)
    _extract_jpeg(variant_path, t * dur_b, var_jpg)
    return {"look_src": src_name, "look_var": var_name}


def score_look(src_path: str, variant_path: str, video: dict | None = None) -> dict:
    """Look gate on the real files. Never uses the VMAF quality proxy.

    ``video`` is the variant's sampled params (crop / trim / speed). Crop-align
    the source; map story-time through trim+speed. Gate 38 is unchanged.
    """
    base = {
        "look_status": "unknown",
        "look_metric": LOOK_METRIC,
        "look_mae": None,
        "look_mae_max": None,
        "look_target": LOOK_LUMA_MAX,
    }
    try:
        dur_a = max(_probe_duration(src_path), 0.1)
        dur_b = max(_probe_duration(variant_path), 0.1)
        crop_a = _crop_prefix(video)
        maes: list[float] = []
        for t_a, t_b in _sample_times(dur_a, dur_b, video):
            maes.append(
                _coarse_luma_mae(src_path, t_a, variant_path, t_b, crop_a=crop_a),
            )
        mean_mae = sum(maes) / len(maes)
        max_mae = max(maes)
        passed = max_mae <= LOOK_LUMA_MAX
        return {
            "look_status": "ok" if passed else "fail",
            "look_metric": LOOK_METRIC,
            "look_mae": round(mean_mae, 2),
            "look_mae_max": round(max_mae, 2),
            "look_target": LOOK_LUMA_MAX,
        }
    except (OSError, ValueError, subprocess.CalledProcessError, IndexError):
        return base
