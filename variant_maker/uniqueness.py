"""Local video uniqueness scorer: TikFusion-aligned SSIM "bits" via ffmpeg.

Samples 3 frames at 25% / 50% / 75% of duration, scales to a fixed size, runs
ffmpeg SSIM per pair, then converts like TikFusion:

    bits = round((1 - mean_ssim) * 64)

Higher bits = more different. This improves local duplicate-resilience tuning;
it does not guarantee platform accept rates. The SSIM canvas follows the source
orientation so a 16:9 clip is not letterboxed into 9:16 (that made landscape
packs look ~90% unique after Fast stretched them to 1080×1920).
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile

METRIC_VERSION = "ssim_bits_v1"
# TikFusion Smart Detector floor ≈ 18 bits (~28% unique). Fast vs-source *gate*
# is 24 bits (24/64 = 0.375 ≈ 38% UI). 1080 talking-head medium *can* score
# ~35–42 bits (~55–65% UI) via crop + chroma 34–42. That same
# chroma on 720 is snow; soft cloud 4–7 lands ~24 bits (38%). 720 luma
# dust 8–12 (`quietdustmed` c0s=9) was usable but scored 23 bits. 11–13
# aims at the 24-bit gate without redrawing 15–17. Instagram 720 also needs
# crop leftover from the top (keep 0.86–0.90): centered 0.92 keep scored
# 20 bits on portrait.mp4 and a Fast 20 never cleared. Still not the 55%
# 1080 band, and still not a higher floor. Rebuild / native-canvas SSIM do not
# buy 55% on a still face. AQMTp-class stills that fill 576 stay ~18 bits on
# signed medium. Shade overlays are rejected (lookaqmtp). Look-first gates
# actual frames (`look.py`); do not treat these bits as a look check.
# Not Pixel AI scramble.
# Raising the gate to 32 previously forced strong on a whole Fast 20-pack.
# Local uniqueness gate only — not a platform verdict.
TARGET_BITS = 24
DEFAULT_TARGET = TARGET_BITS / 64.0  # 24/64 = 0.375
# Not a skip-escalate shortcut. Hunt 24 first (medium, then one strong).
# Only *after* that hunt: 19 bits (~30% UI) still ships as below_target.
# Under 19 is below TikFusion's ~18-bit / ~28% floor — do not push those files.
FLOOR_BITS = 19
DEFAULT_FLOOR = FLOOR_BITS / 64.0  # 19/64 ≈ 0.297 → 30% UI
# Same-batch peer floor. 20 medium copies of a talking-head already land ~28–31
# vs each other; 24 keeps them spread without forcing strong.
MIN_PEER_BITS = 24
DEFAULT_PEER = MIN_PEER_BITS  # alias
MAX_PASSES = 3
FRAME_FRACS = (0.25, 0.50, 0.75)
# Default SSIM canvas is portrait (9:16). Landscape / square sources use
# ssim_canvas() so a 16:9 clip is not letterboxed into 9:16 (that inflated
# uniqueness when Fast used to stretch landscape into 1080×1920).
SSIM_WIDTH = 576
SSIM_HEIGHT = 1024
SSIM_LONG = 1024
SSIM_SHORT = 576

_SSIM_ALL_RE = re.compile(r"SSIM\s+(?:Y|R):[^\n]*?\sAll:([0-9.]+)")


def _probe_duration(path: str) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    raw = out.stdout.strip()
    if not raw or raw.upper() == "N/A":
        raise ValueError(f"no valid duration in ffprobe output: {raw!r}")
    try:
        duration = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"no valid duration in ffprobe output: {raw!r}") from exc
    return max(duration, 0.1)


def bits_from_ssim(mean_ssim: float) -> int:
    """TikFusion conversion: bits ∈ [0, 64], higher = more different."""
    return int(round((1.0 - float(mean_ssim)) * 64))


def status_for_bits(bits: int | None, *, target: float | None) -> str:
    """Pass line is ``target`` (24 bits). After the hunt, FLOOR_BITS (19) still ships."""
    if bits is None:
        return "unknown"
    if target is None:
        return "ok"
    score = max(0.0, min(1.0, float(bits) / 64.0))
    if score >= float(target):
        return "ok"
    if int(bits) >= FLOOR_BITS:
        return "below_target"
    return "below_floor"


def similarity_from_uniqueness(uniqueness: float) -> float:
    """Cheap Path-B readout: similarity = 1 − uniqueness (same SSIM-bits scale)."""
    return 1.0 - float(uniqueness)


def ssim_canvas(width: int | None, height: int | None) -> tuple[int, int]:
    """SSIM sample size matching source orientation. Long side 1024, even."""
    w = int(width or 0)
    h = int(height or 0)
    if w <= 0 or h <= 0:
        return SSIM_WIDTH, SSIM_HEIGHT
    if w == h:
        return SSIM_SHORT, SSIM_SHORT
    if w > h:
        return SSIM_LONG, SSIM_SHORT
    return SSIM_SHORT, SSIM_LONG


def ssim_scale_filter(width: int, height: int) -> str:
    """Fit inside the canvas and pad; never stretch."""
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    )


def _extract_frame(
    path: str, t: float, out_path: str, *, canvas: tuple[int, int] | None = None,
) -> None:
    """Extract one scaled frame near ``t`` seconds. Falls back to t=0 if seek misses."""
    cw, ch = canvas if canvas is not None else (SSIM_WIDTH, SSIM_HEIGHT)
    vf = ssim_scale_filter(cw, ch)
    last_err: subprocess.CalledProcessError | None = None
    # Post-input -ss is more reliable on short clips; retry t=0 if the seek is past EOF.
    for seek in (max(0.0, t), 0.0):
        if os.path.exists(out_path):
            os.remove(out_path)
        try:
            subprocess.run(
                [
                    "ffmpeg", "-v", "error",
                    "-i", path,
                    "-ss", f"{seek:.6f}",
                    "-vf", vf,
                    "-frames:v", "1",
                    "-y", out_path,
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            last_err = exc
            continue
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return
    if last_err is not None:
        raise last_err
    raise ValueError(f"failed to extract frame at t={t} from {path}")



def _ssim_pair(ref_path: str, dist_path: str) -> float:
    """Return All-channel SSIM for two still images (0..1)."""
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "info",
            "-i", ref_path,
            "-i", dist_path,
            "-lavfi", "ssim",
            "-f", "null", "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    # SSIM line is on stderr for ffmpeg.
    text = (proc.stderr or "") + (proc.stdout or "")
    match = _SSIM_ALL_RE.search(text)
    if not match:
        raise ValueError(f"no SSIM All= value in ffmpeg output: {text[-500]!r}")
    return float(match.group(1))


def mean_ssim(path_a: str, path_b: str) -> float:
    """Mean SSIM across the three TikFusion-aligned sample points."""
    from .probe import probe

    info = probe(path_a, hash_content=False)
    canvas = ssim_canvas(info.width, info.height)
    dur_a = max(float(info.duration_s or 0.0), 0.1)
    dur_b = _probe_duration(path_b)
    with tempfile.TemporaryDirectory(prefix="vm-ssim-") as tmp:
        scores: list[float] = []
        for i, frac in enumerate(FRAME_FRACS):
            fa = os.path.join(tmp, f"a_{i}.png")
            fb = os.path.join(tmp, f"b_{i}.png")
            _extract_frame(path_a, frac * dur_a, fa, canvas=canvas)
            _extract_frame(path_b, frac * dur_b, fb, canvas=canvas)
            scores.append(_ssim_pair(fa, fb))
        return sum(scores) / len(scores)


def bits_vs(path_a: str, path_b: str) -> int:
    """SSIM bits between two videos (TikFusion-style). Raises on probe/ffmpeg failure."""
    return bits_from_ssim(mean_ssim(path_a, path_b))


def score_uniqueness(
    src_path: str,
    variant_path: str,
    *,
    target: float | None = None,
    n_frames: int | None = None,  # retained for call-site compat; ignored (fixed 3 frames)
    copyid: str | bool | None = None,
    extra_heads: dict | None = None,
    attach_heads: bool = True,
) -> dict:
    """Score variant uniqueness vs source.

    Returns uniqueness ∈ [0, 1] as bits/64, plus raw ``bits`` for logs/tests.

    ``copyid``: ``off`` (default) | ``record`` | ``gate``. Extra visual/audio
    heads are lazy (see ``variant_maker.copyid``). ``gate`` fuses with min
    uniqueness; SSIM ``below_floor`` is never overridden. ``extra_heads``
    injects already-scored heads (tests). ``attach_heads=False`` skips extra
    heads on ``record`` so Generate wait stays SSIM-bound; ``gate`` still
    fuses here because uniqueness_status depends on it.
    """
    del n_frames  # fixed FRAME_FRACS — kept in signature for older callers
    base = {
        "uniqueness": None,
        "uniqueness_status": "unknown",
        "uniqueness_metric": METRIC_VERSION,
        "uniqueness_target": target,
        "bits": None,
    }
    try:
        bits = bits_vs(src_path, variant_path)
        score = max(0.0, min(1.0, bits / 64.0))
        status = status_for_bits(bits, target=target)
        result = {
            "uniqueness": score,
            "uniqueness_status": status,
            "uniqueness_metric": METRIC_VERSION,
            "uniqueness_target": target,
            "uniqueness_floor": DEFAULT_FLOOR,
            "bits": bits,
        }
    except (OSError, subprocess.CalledProcessError, ValueError, TypeError):
        return base
    if not attach_heads:
        from .copyid import normalize_mode
        if normalize_mode(copyid) != "gate":
            return result
    return _attach_copyid(
        result, src_path, variant_path,
        target=target, copyid=copyid, extra_heads=extra_heads,
    )


def attach_copyid_heads(
    result: dict,
    src_path: str,
    variant_path: str,
    *,
    copyid: str | bool | None = "record",
    extra_heads: dict | None = None,
) -> dict:
    """Attach visual/audio heads after SSIM. Used by ``record`` so Chromaprint
    is not on the uniqueness wait. ``gate`` should score inside ``score_uniqueness``.
    """
    return _attach_copyid(
        dict(result), src_path, variant_path,
        target=result.get("uniqueness_target"),
        copyid=copyid, extra_heads=extra_heads,
    )


def _attach_copyid(
    result: dict,
    src_path: str,
    variant_path: str,
    *,
    target: float | None,
    copyid: str | bool | None,
    extra_heads: dict | None,
) -> dict:
    # Fast path: do not import copyid (or probe fpcalc/torch) on the default off gate.
    if extra_heads is None and copyid is None:
        env = os.environ.get("VARIANT_MAKER_COPYID")
        if not env or str(env).strip().lower() in ("off", "0", "false", "no", ""):
            return result
    from .copyid import fuse_heads, normalize_mode, score_heads

    mode = normalize_mode(copyid)
    # extra_heads is a test injection; it still requires record|gate to attach.
    if mode == "off":
        return result
    extras = dict(extra_heads) if extra_heads is not None else score_heads(src_path, variant_path)
    ssim_head = {
        "uniqueness": result["uniqueness"],
        "sim": None if result["uniqueness"] is None else 1.0 - result["uniqueness"],
        "status": result["uniqueness_status"],
        "available": result["uniqueness"] is not None,
        "bits": result["bits"],
        "metric": METRIC_VERSION,
    }
    heads = {"ssim": ssim_head, **extras}
    result = {**result, "heads": heads, "copyid_mode": mode}
    if mode != "gate":
        return result
    usable = [
        name for name, head in extras.items()
        if head and head.get("available") and head.get("uniqueness") is not None
    ]
    if not usable:
        return result
    # below_floor is the SSIM ship floor — embeddings must not hide a twin.
    if result["uniqueness_status"] == "below_floor":
        return result
    fused = fuse_heads(heads, target=target)
    result["uniqueness"] = fused["uniqueness"]
    result["uniqueness_status"] = fused["uniqueness_status"]
    result["uniqueness_metric"] = fused["uniqueness_metric"]
    result["fused_from"] = fused["fused_from"]
    return result
