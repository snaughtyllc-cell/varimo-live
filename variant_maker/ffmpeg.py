"""Phase 5. Build + run one ffmpeg invocation per variant.

Applies color.output_color_args(...) on OUTPUT, -map_metadata -1, -fflags +bitexact,
libx264 with sampled crf/gop, aac audio, and a social maxrate ceiling (constrained
VBR — CRF still picks quality). Returns the exact command string for the manifest
(the reproduction contract — x264 isn't bit-deterministic, so the cmd + params ARE the record).
"""
from __future__ import annotations

import shlex
import subprocess

from .color import output_color_args, resolve_output_color
from .filtergraph import build_audio_filters, build_video_filters
from .platforms import Platform, x264_rate_args
from .probe import SourceInfo

# None = not probed yet. Cached so has_rubberband() does not spawn ffmpeg per variant.
_rubberband_cached: bool | None = None


def has_rubberband() -> bool:
    """True when this ffmpeg build exposes the rubberband audio filter.

    Never raises: missing ffmpeg, a failed listing, or a listing without the
    filter all return False. Result is cached at module level.
    """
    global _rubberband_cached
    if _rubberband_cached is not None:
        return _rubberband_cached
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True, text=True, check=False,
        )
    except OSError:
        _rubberband_cached = False
        return False
    if result.returncode != 0:
        _rubberband_cached = False
        return False
    listing = result.stdout or ""
    _rubberband_cached = any(
        "rubberband" in line.split() for line in listing.splitlines()
    )
    return _rubberband_cached


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise subprocess.CalledProcessError(
            result.returncode, result.args, output=result.stdout, stderr=detail or result.stderr,
        )
    return result


def build_render_cmd(src: SourceInfo, params: dict, platform: Platform, out_path: str) -> list[str]:
    """PURE: assemble the full ffmpeg argv for one variant (unit-tested without ffmpeg)."""
    v = params["video"]
    a = params["audio"]
    out_color = resolve_output_color(src.color)

    vf = build_video_filters(params, src, platform)
    use_complex = ";" in vf
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", src.path,
        "-map_metadata", "-1",
        "-fflags", "+bitexact",
    ]
    if use_complex:
        if not vf.endswith("]"):
            vf = f"{vf}[v]"
        cmd += ["-filter_complex", vf, "-map", "[v]"]
    else:
        cmd += ["-vf", vf, "-map", "0:v:0"]
    if src.has_audio:
        cmd += ["-map", "0:a:0"]
    cmd += [
        "-c:v", "libx264", "-preset", "medium",
        "-crf", str(v["crf"]), "-g", str(v["gop"]),
        *x264_rate_args(platform),
        "-pix_fmt", "yuv420p",
        *output_color_args(out_color),
    ]
    if src.has_audio:
        af = build_audio_filters(params, src, True)
        if af:
            cmd += ["-af", af]
        cmd += ["-c:a", "aac", "-b:a", f"{a['aac_kbps']}k"]
    else:
        cmd += ["-an"]
    cmd += [out_path]
    return cmd


def render_variant(
    src: SourceInfo, params: dict, platform: Platform, out_path: str, *, dry_run: bool = False
) -> tuple[str, str]:
    """Build the command, render the variant (unless dry_run), return (out_path, cmd_str)."""
    cmd = build_render_cmd(src, params, platform, out_path)
    cmd_str = shlex.join(cmd)
    if not dry_run:
        run(cmd)
    return out_path, cmd_str
