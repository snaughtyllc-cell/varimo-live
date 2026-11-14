"""Phase 6. In-loop quality guard. Fail -> reduce strength & regenerate.

histogram_sanity(src, variant) -> bool   # always on, cheap; catches wash-out / crush
vmaf(src, variant, params) -> float      # stronger; compute on the QUALITY RENDER
  (quality-affecting ops only, at source geometry/timing) because libvmaf needs
  frame-aligned, same-resolution ref & distorted — you CANNOT vmaf across trim/tempo/fps.
"""
from __future__ import annotations

import contextlib
import json
import os
import subprocess
import tempfile

from . import ffmpeg
from .platforms import get_platform
from .probe import SourceInfo

# Geometric/temporal axes are neutralized in the quality proxy: VMAF needs frame-aligned,
# same-resolution ref & distorted, so only the quality-affecting ops (color/sharpen/grain/
# encode + Fast pixel-seed warp) survive — at source geometry and timing. Fingerprint
# rebuild/resample/crop/trim/speed/luma_shade are stripped. Warp stays so VMAF can cap it.
# Look-first (`look.py`) scores the *actual* output; this proxy must not.
_QUALITY_NEUTRAL = {
    "crop_keep": 1.0, "crop_x_frac": 0.5, "crop_y_frac": 0.5,
    "rotate_deg": 0.0, "trim_s": 0.0, "trim_end_s": 0.0, "speed": 1.0,
    "resample_px": 0,
    "keystone_a": 0.0,  # tilt is geometry: in the VMAF proxy it misaligns every pixel (score ~0)
    "rebuild_scale": 1.0,
    "luma_shade": 0.0,
}


@contextlib.contextmanager
def _lavfi_safe(path: str):
    """Yield a path safe to interpolate into a lavfi `movie=` arg.

    Real filenames carry commas/colons/quotes that break the lavfi lexer (multi-level,
    `'` is unreliable to escape). Rather than fight it, symlink to a clean temp name.
    """
    if not any(c in path for c in ":,'[];\\"):
        yield path
        return
    d = tempfile.mkdtemp()
    link = os.path.join(d, "src" + os.path.splitext(path)[1])
    os.symlink(os.path.abspath(path), link)
    try:
        yield link
    finally:
        os.remove(link)
        os.rmdir(d)


def _signalstats(path: str) -> tuple[float, float]:
    """Mean (YAVG luma, SATAVG saturation) across frames via the signalstats lavfi graph."""
    # Audio may precede video by more than the default five-second probe window.
    # Probe up to 100 seconds / 100 MB so movie can discover the pixel format.
    with _lavfi_safe(path) as safe:
        cmd = [
            "ffprobe", "-v", "error", "-f", "lavfi",
            "-i", (
                f"movie={safe}:format_opts='probesize=100000000"
                "\\:analyzeduration=100000000',signalstats"
            ),
            "-show_entries", "frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.SATAVG",
            "-print_format", "json",
        ]
        out = subprocess.run(cmd, check=True, capture_output=True, text=True)
    frames = json.loads(out.stdout).get("frames", [])
    ys, ss = [], []
    for f in frames:
        tags = f.get("tags", {})
        if "lavfi.signalstats.YAVG" in tags:
            ys.append(float(tags["lavfi.signalstats.YAVG"]))
        if "lavfi.signalstats.SATAVG" in tags:
            ss.append(float(tags["lavfi.signalstats.SATAVG"]))
    yavg = sum(ys) / len(ys) if ys else 0.0
    satavg = sum(ss) / len(ss) if ss else 0.0
    return yavg, satavg


def histogram_sanity(src_path: str, variant_path: str, tol: float = 0.06) -> bool:
    """True unless the variant shows a *gross* wash-out / luma collapse.

    Fingerprint presets intentionally nudge saturation/brightness; a tight relative
    tolerance (old behavior) rejected healthy variants and forced endless re-rolls.
    `tol` is kept for call-site compatibility but no longer drives a tight band —
    we only catch catastrophic color failure (wash-out / crushed or blown luma).
    """
    del tol  # intentional: gross-failure checks below replace the old relative band
    src_y, src_s = _signalstats(src_path)
    var_y, var_s = _signalstats(variant_path)

    # Wash-out: saturation collapsed vs a non-trivial source.
    if src_s >= 0.5 and var_s < src_s * 0.4:
        return False
    # Severe luma crush / blow-out (ignore near-black sources).
    if src_y >= 1.0 and (var_y < src_y * 0.5 or var_y > src_y * 1.5):
        return False
    return True


def quality_render(src: SourceInfo, params: dict, out_path: str) -> str:
    """Render the quality proxy: quality ops only, at source geometry/timing (for VMAF)."""
    v = dict(params["video"])
    v.update(_QUALITY_NEUTRAL)
    # Keep the source frame rate: an out_fps of 48/60 makes twice the frames, VMAF pairs them
    # by index, and the score sinks even though the copy looks fine.
    v["out_fps"] = None
    qparams = {"video": v, "audio": params["audio"]}
    ffmpeg.render_variant(src, qparams, get_platform("none"), out_path)
    return out_path


def passes_guard(
    src_path: str, variant_path: str, quality_render_path: str, *, floor: float = 90.0,
    tol: float = 0.06,
) -> dict:
    """Combined guard decision: gross hist sanity + VMAF on the quality render."""
    del variant_path  # full geometric variant is not used for the hist/VMAF decision
    # Hist against the quality proxy (color ops only) — not the full geometric variant —
    # so crop/speed fingerprints don't pollute the wash-out check.
    hist_ok = histogram_sanity(src_path, quality_render_path, tol)
    score = vmaf(src_path, quality_render_path)
    # VMAF is authoritative for "looks fine"; hist only vetoes catastrophic wash-out.
    return {"vmaf": score, "histogram_ok": hist_ok, "passed": bool(hist_ok and score >= floor)}


def _dimensions(path: str) -> tuple[int, int]:
    """(width, height) of the first video stream via ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    w, h = out.split("x")
    return int(w), int(h)


def spatial_coherence(output_path: str, reference_path: str) -> float:
    """VMAF of the hq output (downscaled to the pre-upscale geometry) vs the clean
    PRE-upscale render. The spatial-corruption guard.

    The histogram + VMAF guard checks color and a geometry-neutral quality proxy that never
    runs through the upscaler — so a tile-seam / garbled-tile upscale passes it (this actually
    happened; only the eye caught it). Here we feed the ACTUAL upscaled frames back through:
    the output is scaled to the reference's exact resolution (probed via ffprobe) so libvmaf
    can frame-align them. Coherent invented detail round-trips high; shuffled/misaligned tiles
    collapse. VMAF is luma-only, so the saturation correction baked into the output doesn't
    move it. (Explicit `scale` — not `scale2ref`, which is deprecated and miscounts frames /
    aborts on ffmpeg 7; this keeps the guard robust across the dev and GPU-worker ffmpeg builds.)
    """
    w, h = _dimensions(reference_path)
    fd, log_path = tempfile.mkstemp(suffix=".vmaf.json")
    os.close(fd)
    cmd = [
        "ffmpeg", "-hide_banner", "-v", "error",
        "-i", output_path, "-i", reference_path,
        "-lavfi",
        (f"[0:v]scale={w}:{h}:flags=lanczos[dist];"
         f"[dist][1:v]libvmaf=log_fmt=json:log_path={log_path}"),
        "-f", "null", "-",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        with open(log_path) as f:
            data = json.load(f)
    finally:
        if os.path.exists(log_path):
            os.remove(log_path)
    pooled = data.get("pooled_metrics", {}).get("vmaf")
    if pooled:
        return float(pooled["mean"])
    frames = data.get("frames", [])
    vals = [fr["metrics"]["vmaf"] for fr in frames if "vmaf" in fr.get("metrics", {})]
    return sum(vals) / len(vals) if vals else 0.0


def regen_until_pass(attempt, *, max_regen: int = 3, strength: float = 1.0,
                     falloff: float = 0.6, on_regen=None) -> dict:
    """Reject -> reduce strength -> regenerate, bounded by max_regen.

    `attempt(strength) -> dict` samples + renders + guards one variant and returns its guard
    result (must include 'passed'). On failure, strength is scaled by `falloff` and retried.
    `on_regen(regen, max_regen)` (optional) fires once before each retry. Returns the first
    passing result, else the best-effort last attempt; tags 'regen_count'.
    """
    result = attempt(strength)
    regen = 0
    while not result["passed"] and regen < max_regen:
        regen += 1
        if on_regen is not None:
            on_regen(regen, max_regen)
        strength *= falloff
        result = attempt(strength)
    return {**result, "regen_count": regen}


def vmaf(src_path: str, quality_render_path: str) -> float:
    """libvmaf score (0..100) of the quality render vs source. Both MUST be frame-aligned
    and the same resolution — that's what `quality_render` guarantees."""
    # mkstemp gives a special-char-free path, so log_path needs no lavfi escaping.
    fd, log_path = tempfile.mkstemp(suffix=".vmaf.json")
    os.close(fd)
    cmd = [
        "ffmpeg", "-hide_banner", "-v", "error",
        "-i", quality_render_path, "-i", src_path,
        "-lavfi", f"[0:v][1:v]libvmaf=log_fmt=json:log_path={log_path}",
        "-f", "null", "-",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        with open(log_path) as f:
            data = json.load(f)
    finally:
        if os.path.exists(log_path):
            os.remove(log_path)
    pooled = data.get("pooled_metrics", {}).get("vmaf")
    if pooled:
        return float(pooled["mean"])
    frames = data.get("frames", [])
    vals = [fr["metrics"]["vmaf"] for fr in frames if "vmaf" in fr.get("metrics", {})]
    return sum(vals) / len(vals) if vals else 0.0
