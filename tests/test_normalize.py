"""Upload proxy: HDR/10-bit → SDR and 4K → long-edge ≤ 1920 (one encode)."""

from __future__ import annotations

import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from conftest import HAS_FFMPEG

from variant_maker.normalize import (
    _proxy_vf,
    is_hdr_or_10bit,
    maybe_normalize_upload,
    needs_size_proxy,
    needs_upload_proxy,
    proxy_output_size,
    proxy_scale_filter,
)
from variant_maker.probe import ColorTags, SourceInfo, probe


def test_needs_size_proxy_skips_1080_reels() -> None:
    assert needs_size_proxy(1080, 1920) is False
    assert needs_size_proxy(1920, 1080) is False
    assert needs_size_proxy(720, 1280) is False


def test_needs_size_proxy_catches_iphone_4k() -> None:
    assert needs_size_proxy(2160, 3840) is True
    assert needs_size_proxy(3840, 2160) is True
    assert needs_size_proxy(1921, 1080) is True


def test_proxy_output_size_portrait_4k() -> None:
    assert proxy_output_size(2160, 3840) == (1080, 1920)


def test_proxy_output_size_landscape_4k() -> None:
    assert proxy_output_size(3840, 2160) == (1920, 1080)


def test_proxy_output_size_already_1080() -> None:
    assert proxy_output_size(1080, 1920) == (1080, 1920)


def test_proxy_scale_filter_even_and_explicit() -> None:
    vf = proxy_scale_filter(2160, 3840)
    assert "scale=1080:1920" in vf
    assert "flags=fast_bilinear" in vf


def test_is_hdr_or_10bit() -> None:
    assert is_hdr_or_10bit("yuv420p", "bt709") is False
    assert is_hdr_or_10bit("yuv420p10le", "bt709") is True
    assert is_hdr_or_10bit("yuv420p", "arib-std-b67") is True
    assert is_hdr_or_10bit("yuv420p", "smpte2084") is True


def _sdr_1080() -> SourceInfo:
    return SourceInfo(
        path="x.mp4",
        sha256="a" * 64,
        duration_s=3.0,
        width=1080,
        height=1920,
        fps=30.0,
        has_audio=True,
        color=ColorTags(range="tv", primaries="bt709", transfer="bt709", matrix="bt709"),
    )


def _sdr_4k() -> SourceInfo:
    return SourceInfo(
        path="x.mp4",
        sha256="a" * 64,
        duration_s=3.0,
        width=2160,
        height=3840,
        fps=30.0,
        has_audio=True,
        color=ColorTags(range="tv", primaries="bt709", transfer="bt709", matrix="bt709"),
    )


def test_needs_upload_proxy_1080_sdr_false() -> None:
    assert needs_upload_proxy(_sdr_1080(), pix_fmt="yuv420p") is False


def test_needs_upload_proxy_4k_sdr_true() -> None:
    assert needs_upload_proxy(_sdr_4k(), pix_fmt="yuv420p") is True


def test_needs_upload_proxy_hdr_1080_true() -> None:
    m = SourceInfo(
        path="x.mp4",
        sha256="a" * 64,
        duration_s=3.0,
        width=1080,
        height=1920,
        fps=30.0,
        has_audio=True,
        color=ColorTags(range="tv", primaries="bt2020", transfer="arib-std-b67", matrix="bt2020nc"),
    )
    assert needs_upload_proxy(m, pix_fmt="yuv420p") is True


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_proxy_upload_downscales_oversized(tmp_path: Path) -> None:
    from variant_maker.ffmpeg import run
    from variant_maker.normalize import proxy_upload

    src = tmp_path / "big.mp4"
    dest = tmp_path / "proxy.mp4"
    # 2000×1120 is just over 1920 long-edge; cheap to encode in CI.
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=0.4:size=2000x1120:rate=24",
            "-pix_fmt",
            "yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            str(src),
        ]
    )
    meta = probe(str(src))
    assert needs_size_proxy(meta.width, meta.height)
    out = proxy_upload(src, dest, meta)
    assert out == dest
    got = probe(str(dest))
    w, h = proxy_output_size(meta.width, meta.height)
    assert got.width == w
    assert got.height == h
    assert dest.stat().st_size < src.stat().st_size


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_proxy_upload_keeps_audio(tmp_path: Path) -> None:
    from variant_maker.ffmpeg import run
    from variant_maker.normalize import proxy_upload

    src = tmp_path / "talk.mp4"
    dest = tmp_path / "proxy.mp4"
    run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc=duration=0.5:size=2000x1120:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", "-shortest", str(src),
        ]
    )
    meta = probe(str(src))
    assert meta.has_audio
    out = proxy_upload(src, dest, meta)
    got = probe(str(out))
    assert got.has_audio
    assert got.width < meta.width or got.height < meta.height


def test_proxy_upload_does_not_strip_audio_when_aac_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """iPhone spatial / odd audio must not fall back to a silent proxy."""
    from variant_maker.normalize import proxy_upload

    src = tmp_path / "talk.mp4"
    dest = tmp_path / "proxy.mp4"
    src.write_bytes(b"clip")
    info = replace(_sdr_4k(), path=str(src))
    calls: list[list[str]] = []

    def fake_run(cmd: list[str]) -> None:
        calls.append(list(cmd))
        if "-an" in cmd:
            raise AssertionError("proxy must not strip audio when the source has it")
        try:
            codec = cmd[cmd.index("-c:a") + 1]
        except ValueError:
            return
        if codec == "aac":
            raise subprocess.CalledProcessError(1, cmd, stderr="aac")

    monkeypatch.setattr("variant_maker.normalize._run_ffmpeg", fake_run)
    monkeypatch.setattr("variant_maker.normalize._ffprobe_field", lambda *_a, **_k: "yuv420p")
    proxy_upload(src, dest, info)
    assert not any("-an" in c for c in calls)
    codecs = [c[c.index("-c:a") + 1] for c in calls if "-c:a" in c]
    assert codecs == ["aac", "copy"]


def test_rotated_iphone_4k_proxy_targets_1080x1920() -> None:
    """Coded landscape + 90° is a portrait phone clip — proxy must not be 1920×1080."""
    from variant_maker.probe import _parse_ffprobe

    info = _parse_ffprobe(
        {
            "streams": [{
                "codec_type": "video", "width": 3840, "height": 2160,
                "tags": {"rotate": "90"},
                "color_range": "tv", "color_primaries": "bt709",
                "color_transfer": "bt709", "color_space": "bt709",
            }],
            "format": {"duration": "16.5"},
        },
        "IMG_0683.MOV",
        "h",
    )
    assert needs_size_proxy(info.width, info.height)
    assert proxy_output_size(info.width, info.height) == (1080, 1920)
    vf = _proxy_vf(info, hdr=False)
    assert "scale=1080:1920" in vf
    assert "scale=1920:1080" not in vf


def test_ingest_proxy_filter_never_uses_tonemap() -> None:
    """Linear zscale/tonemap on 4K OOMs Railway and takes Studio down with it."""
    vf = _proxy_vf(_sdr_4k(), hdr=True)
    assert "tonemap" not in vf
    assert "zscale" not in vf
    assert "format=yuv420p" in vf
    assert "scale=1080:1920" in vf


def test_maybe_normalize_keeps_unreadable_file(tmp_path: Path) -> None:
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"not-a-video")
    assert maybe_normalize_upload(str(src)) == str(src)
    assert src.exists()


def test_maybe_normalize_keeps_original_if_encode_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"x")

    def fake_probe(path: str, **_kwargs):
        return _sdr_4k()

    def boom(*_a, **_k):
        raise subprocess.CalledProcessError(1, ["ffmpeg"], stderr="hevc")

    monkeypatch.setattr("variant_maker.normalize.probe", fake_probe)
    monkeypatch.setattr("variant_maker.normalize._ffprobe_field", lambda *_a, **_k: "yuv420p")
    monkeypatch.setattr("variant_maker.normalize.proxy_upload", boom)
    assert maybe_normalize_upload(str(src)) == str(src)
    assert src.exists()
