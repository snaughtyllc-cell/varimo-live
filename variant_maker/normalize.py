"""Normalize uploads so quality/uniqueness gates see a stable SDR source.

iPhone 4K/HEVC is the common Studio case. Platforms are 1080×1920, so a long-edge
> 1920 source is proxied to ≤1920 in the same encode as any HDR/10-bit → 8-bit
H.264 pass. That shrinks R2 + RunPod work.

This pass must NEVER fail a job or take Studio down. A 4K linear tonemap on
Railway OOMs the box (uploads then 502). If the proxy fails, keep the original
and generate as before — slower, but it still works.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .color import BT709, output_color_args
from .probe import SourceInfo, probe

# Matches reels/tiktok/shorts long edge. 1080×1920 and 1920×1080 stay as-is.
# Width/height come from probe display size (iPhone 4K portrait is often coded
# 3840×2160 + rotate 90; ffmpeg autorotates on decode, so the proxy scale must
# match the upright frame — not the coded landscape).
MAX_LONG_EDGE = 1920
_HDR_TRANSFERS = ("smpte2084", "arib-std-b67", "bt2020")
# Fast enough that Railway CPU does not wedge; good enough as a generate source.
_PROXY_PRESET = "veryfast"
_PROXY_CRF = "20"
_PROXY_THREADS = "2"
_PROXY_TIMEOUT_S = 600
_PROXY_FAIL = (OSError, subprocess.SubprocessError, ValueError)


def _even(n: int) -> int:
    return max(2, n - (n % 2))


def _ffprobe_field(path: str, key: str) -> str:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", f"stream={key}",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return (out.stdout or "").strip()


def is_hdr_or_10bit(pix_fmt: str = "", color_transfer: str = "") -> bool:
    """True for 10-bit / HDR / Dolby Vision sources that break hist+VMAF loops."""
    pix = (pix_fmt or "").lower()
    transfer = (color_transfer or "").lower()
    if "10" in pix or "12" in pix or "p010" in pix:
        return True
    return any(t in transfer for t in _HDR_TRANSFERS)


def needs_sdr_normalize(path: str) -> bool:
    """True for 10-bit / HDR / Dolby Vision sources that break hist+VMAF loops."""
    try:
        pix = _ffprobe_field(path, "pix_fmt")
        transfer = _ffprobe_field(path, "color_transfer")
    except (OSError, subprocess.CalledProcessError):
        return False
    return is_hdr_or_10bit(pix, transfer)


def needs_size_proxy(width: int, height: int, max_long: int = MAX_LONG_EDGE) -> bool:
    """True when the coded long edge is bigger than the platform target."""
    return max(int(width or 0), int(height or 0)) > max_long


def proxy_output_size(
    width: int, height: int, max_long: int = MAX_LONG_EDGE,
) -> tuple[int, int]:
    """Fit inside max_long, keep AR, force even dims (libx264)."""
    w, h = int(width or 0), int(height or 0)
    if w <= 0 or h <= 0:
        return 2, 2
    long_edge = max(w, h)
    if long_edge <= max_long:
        return _even(w), _even(h)
    scale = max_long / long_edge
    return _even(round(w * scale)), _even(round(h * scale))


def proxy_scale_filter(width: int, height: int) -> str:
    """Explicit even scale. Geometry only — not a color conversion."""
    w, h = proxy_output_size(width, height)
    return f"scale={w}:{h}:flags=fast_bilinear,scale=trunc(iw/2)*2:trunc(ih/2)*2"


def needs_upload_proxy(info: SourceInfo, *, pix_fmt: str = "") -> bool:
    """True when ingest should rewrite the file (HDR/10-bit and/or oversized)."""
    transfer = info.color.transfer or ""
    return needs_size_proxy(info.width, info.height) or is_hdr_or_10bit(pix_fmt, transfer)


def _proxy_vf(info: SourceInfo, *, hdr: bool) -> str:
    # No zscale/tonemap here. Linear 4K on Railway OOMs Studio (uploads 502).
    # 10-bit/HDR just becomes 8-bit yuv420p; variant render still color-tags.
    del hdr
    parts: list[str] = []
    if needs_size_proxy(info.width, info.height):
        parts.append(proxy_scale_filter(info.width, info.height))
    parts.append("format=yuv420p")
    return ",".join(parts)


def _run_ffmpeg(cmd: list[str]) -> None:
    subprocess.run(
        cmd, check=True, capture_output=True, timeout=_PROXY_TIMEOUT_S,
    )


def proxy_upload(src: str | Path, dest: str | Path, info: SourceInfo | None = None) -> Path:
    """One cheap H.264 8-bit encode: optional long-edge ≤ 1920 + 8-bit.

    Raises on encode failure. Callers that must not break upload/generate
    (maybe_normalize_upload) catch and keep the original file. If the source
    has audio, never fall back to ``-an`` — a silent proxy is how talking
    clips shipped mute.
    """
    src_path = Path(src)
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    meta = info if info is not None else probe(str(src_path), hash_content=False)
    pix = ""
    try:
        pix = _ffprobe_field(str(src_path), "pix_fmt")
    except (OSError, subprocess.CalledProcessError):
        pix = ""
    hdr = is_hdr_or_10bit(pix, meta.color.transfer or "")
    base = [
        "ffmpeg", "-y", "-hide_banner", "-v", "error",
        "-threads", _PROXY_THREADS,
        "-i", str(src_path),
        "-vf", _proxy_vf(meta, hdr=hdr),
        "-c:v", "libx264", "-preset", _PROXY_PRESET, "-crf", _PROXY_CRF,
        "-pix_fmt", "yuv420p",
        *output_color_args(BT709),
    ]
    cmd = base + ["-map", "0:v:0"]
    if meta.has_audio:
        cmd += ["-map", "0:a:0"]
        try:
            _run_ffmpeg(cmd + ["-c:a", "aac", "-b:a", "192k", str(dest_path)])
            return dest_path
        except _PROXY_FAIL as exc:
            print(
                f"upload proxy aac failed, trying audio copy: {type(exc).__name__}: {exc}",
                flush=True,
            )
        _run_ffmpeg(cmd + ["-c:a", "copy", str(dest_path)])
        return dest_path
    _run_ffmpeg(cmd + ["-an", str(dest_path)])
    return dest_path


def normalize_to_sdr(src_path: str, dst_path: str) -> str:
    """Write an 8-bit yuv420p H.264 proxy. Returns dst_path."""
    return str(proxy_upload(src_path, dst_path))


def maybe_normalize_upload(path: str) -> str:
    """Best-effort 1080/SDR proxy. On any failure, return the original path."""
    try:
        info = probe(path, hash_content=False)
        pix = _ffprobe_field(path, "pix_fmt")
    except (OSError, subprocess.CalledProcessError, ValueError):
        return path
    if not needs_upload_proxy(info, pix_fmt=pix):
        return path
    root, _ext = os.path.splitext(path)
    dst = f"{root}_proxy.mp4"
    try:
        proxy_upload(path, dst, info)
        got = probe(dst, hash_content=False)
        if got.width < 2 or got.height < 2:
            raise ValueError("proxy has no video")
    except _PROXY_FAIL as exc:
        print(f"upload proxy failed, using original: {type(exc).__name__}: {exc}", flush=True)
        if os.path.abspath(dst) != os.path.abspath(path):
            try:
                os.remove(dst)
            except OSError:
                pass
        return path
    if os.path.abspath(dst) != os.path.abspath(path):
        try:
            os.remove(path)
        except OSError:
            pass
    return dst
