import subprocess

import pytest

from variant_maker import quality, ffmpeg
from variant_maker.probe import ColorTags, SourceInfo, probe
from variant_maker.platforms import get_platform
from conftest import HAS_FFMPEG

NONE = get_platform("none")
REELS = get_platform("reels")


def _neutral_params():
    return {
        "video": {
            "crop_keep": 1.0, "rotate_deg": 0.0, "brightness": 0.0, "contrast": 1.0,
            "saturation": 1.0, "gamma": 1.0, "hue_deg": 0.0, "grain": 0.0, "unsharp": 0.0,
            "speed": 1.0, "trim_s": 0.0, "crf": 20, "gop": 60,
        },
        "audio": {"speed": 1.0, "loudnorm_i": -14.0, "eq_bands": 1, "eq_gains": [0.0],
                  "pitch_pct": 0.0, "aac_kbps": 160},
    }


def test_quality_render_strips_rebuild_keeps_warp(monkeypatch, tmp_path):
    """Rebuild/resample are fingerprint (neutralize). Warp stays so VMAF can cap it."""
    captured = {}

    def fake_render(src, params, platform, path, dry_run=False):
        captured["video"] = dict(params["video"])
        captured["platform"] = platform.name
        open(path, "w").close()
        return path, "cmd"

    monkeypatch.setattr(ffmpeg, "render_variant", fake_render)
    src = SourceInfo(
        "in.mp4", "abc", 4.0, 1080, 1920, 30.0, True,
        ColorTags("tv", "bt709", "bt709", "bt709"),
    )
    params = _neutral_params()
    params["video"].update({
        "resample_px": -8, "resample_flags": "spline",
        "rebuild_scale": 0.72, "warp_k1": 0.008,
        "grain": 44.0, "noise_chroma": True, "luma_shade": 96.0,
    })
    quality.quality_render(src, params, str(tmp_path / "qr.mp4"))
    assert captured["platform"] == "none"
    assert captured["video"]["resample_px"] == 0
    assert captured["video"]["rebuild_scale"] == 1.0
    assert captured["video"]["warp_k1"] == 0.008
    # Grain stays in the VMAF proxy (including chroma-only talking-head noise).
    assert captured["video"]["grain"] == 44.0
    assert captured["video"]["noise_chroma"] is True
    # Low-freq shade leftover is stripped on the VMAF proxy. Look-first
    # scores the actual file instead.
    assert captured["video"]["luma_shade"] == 0.0


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_histogram_sanity_passes_clean_reencode(real_clip, tmp_path):
    """A correctly-tagged, color-neutral re-encode keeps luma+saturation -> passes."""
    src = probe(real_clip)
    out = str(tmp_path / "clean.mp4")
    ffmpeg.render_variant(src, _neutral_params(), NONE, out)
    assert quality.histogram_sanity(real_clip, out) is True


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_signalstats_handles_special_char_paths(real_clip, tmp_path):
    """Real filenames have commas/quotes/spaces; lavfi movie= must not break on them."""
    import shutil
    weird = str(tmp_path / "a,b'c d.mp4")
    shutil.copy(real_clip, weird)
    assert quality.histogram_sanity(weird, weird) is True  # identical file -> identical stats


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_histogram_sanity_fails_washed_out(real_clip, tmp_path):
    """The wash-out symptom: saturation collapses -> guard rejects it."""
    out = str(tmp_path / "washed.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", real_clip,
         "-vf", "eq=saturation=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-an", out],
        check=True, capture_output=True,
    )
    assert quality.histogram_sanity(real_clip, out) is False


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_quality_render_matches_source_geometry(real_clip, tmp_path):
    """The quality proxy strips geometric/temporal ops so VMAF can frame-align it to source."""
    src = probe(real_clip)
    qr = quality.quality_render(src, _neutral_params(), str(tmp_path / "qr.mp4"))
    info = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", qr],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    assert info == f"{src.width},{src.height}"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_vmaf_high_for_clean_quality_render(real_clip, tmp_path):
    src = probe(real_clip)
    qr = quality.quality_render(src, _neutral_params(), str(tmp_path / "clean.mp4"))
    assert quality.vmaf(real_clip, qr) > 85


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_vmaf_drops_for_degraded_render(real_clip, tmp_path):
    src = probe(real_clip)
    clean = quality.quality_render(src, _neutral_params(), str(tmp_path / "clean.mp4"))
    bad_params = _neutral_params()
    bad_params["video"].update({"crf": 51, "grain": 40.0})
    bad = quality.quality_render(src, bad_params, str(tmp_path / "bad.mp4"))
    assert quality.vmaf(real_clip, bad) < quality.vmaf(real_clip, clean) - 10


# ---- spatial-corruption guard (VMAF hq-vs-pre-upscale) ----------------------
# The histogram+VMAF guard misses spatial garble (the Real-ESRGAN tile-seam bug passed
# everything; only the eye caught it). This guard downscales the hq output back to the
# clean PRE-upscale geometry and VMAFs it against that pre-upscale render: coherent detail
# round-trips high, shuffled/rotated tiles collapse.

def _square_clip(path, size=128, rate=10, dur=0.4):
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", f"testsrc2=size={size}x{size}:rate={rate}:duration={dur}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True, capture_output=True,
    )
    return str(path)


def _vfilter(src, dst, vf):
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf,
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dst)],
        check=True, capture_output=True,
    )
    return str(dst)


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_spatial_coherence_high_for_clean_upscale(tmp_path):
    ref = _square_clip(tmp_path / "pre.mp4")                       # the pre-upscale render
    good = _vfilter(ref, tmp_path / "hq.mp4", "scale=256:256:flags=lanczos")
    assert quality.spatial_coherence(good, ref) > 80


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_spatial_coherence_collapses_for_garbled_upscale(tmp_path):
    ref = _square_clip(tmp_path / "pre.mp4")
    # 90° rotate = a structural garble analogous to misaligned tile seams, dims preserved
    garbled = _vfilter(ref, tmp_path / "hq.mp4", "scale=256:256:flags=lanczos,transpose=1")
    clean = _vfilter(ref, tmp_path / "ok.mp4", "scale=256:256:flags=lanczos")
    assert quality.spatial_coherence(garbled, ref) < quality.spatial_coherence(clean, ref) - 20
    assert quality.spatial_coherence(garbled, ref) < 60


# ---- regen loop (pure: reject -> reduce strength -> regenerate) -------------

def test_regen_loop_reduces_strength_until_pass():
    seen = []

    def attempt(strength):
        seen.append(strength)
        return {"passed": strength <= 0.4, "vmaf": 100 * strength, "histogram_ok": True}

    res = quality.regen_until_pass(attempt, max_regen=3, strength=1.0, falloff=0.6)
    assert res["passed"] is True
    assert res["regen_count"] == 2
    assert seen == [1.0, pytest.approx(0.6), pytest.approx(0.36)]


def test_regen_loop_bounded_by_max_regen():
    calls = {"n": 0}

    def attempt(strength):
        calls["n"] += 1
        return {"passed": False, "vmaf": 10.0, "histogram_ok": False}

    res = quality.regen_until_pass(attempt, max_regen=2, strength=1.0)
    assert res["passed"] is False
    assert res["regen_count"] == 2
    assert calls["n"] == 3  # initial attempt + 2 regenerations


# ---- combined guard decision (integration) ----------------------------------

@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_passes_guard_accepts_clean_variant(real_clip, tmp_path):
    src = probe(real_clip)
    variant, _ = ffmpeg.render_variant(src, _neutral_params(), REELS, str(tmp_path / "v.mp4"))
    qr = quality.quality_render(src, _neutral_params(), str(tmp_path / "qr.mp4"))
    r = quality.passes_guard(real_clip, variant, qr)
    assert r["passed"] is True and r["vmaf"] > 90 and r["histogram_ok"] is True


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_passes_guard_rejects_degraded_variant(real_clip, tmp_path):
    src = probe(real_clip)
    bad = _neutral_params()
    bad["video"].update({"crf": 51, "grain": 40.0})
    variant, _ = ffmpeg.render_variant(src, bad, REELS, str(tmp_path / "v.mp4"))
    qr = quality.quality_render(src, bad, str(tmp_path / "qr.mp4"))
    assert quality.passes_guard(real_clip, variant, qr)["passed"] is False


def test_regen_until_pass_calls_on_regen_each_retry():
    from variant_maker import quality

    calls = []
    results = [
        {"passed": False}, {"passed": False}, {"passed": True},
    ]

    def attempt(strength):
        return results[len(calls)] if False else results.pop(0)

    out = quality.regen_until_pass(
        attempt, max_regen=3, strength=1.0,
        on_regen=lambda regen, mx: calls.append((regen, mx)),
    )
    assert out["passed"] is True
    assert out["regen_count"] == 2
    assert calls == [(1, 3), (2, 3)]


def test_regen_until_pass_on_regen_optional():
    from variant_maker import quality
    out = quality.regen_until_pass(lambda s: {"passed": True}, max_regen=3)
    assert out["regen_count"] == 0  # no on_regen, no error


def test_quality_render_strips_keystone(monkeypatch, tmp_path):
    """Keystone tilt is geometry: left in the VMAF proxy it shifts pixels by up to ~6% of the
    width at one edge and VMAF collapses to ~0, so every tilted copy failed the gate and was
    regenerated max_regen times before shipping best_effort."""
    captured = {}

    def fake_render(src, params, platform, path, dry_run=False):
        captured["video"] = dict(params["video"])
        open(path, "w").close()
        return path, "cmd"

    monkeypatch.setattr(ffmpeg, "render_variant", fake_render)
    src = SourceInfo(
        "in.mp4", "abc", 4.0, 1080, 1920, 30.0, True,
        ColorTags("tv", "bt709", "bt709", "bt709"),
    )
    params = _neutral_params()
    params["video"]["keystone_a"] = -0.03
    quality.quality_render(src, params, str(tmp_path / "qr.mp4"))
    assert captured["video"]["keystone_a"] == 0.0
    assert params["video"]["keystone_a"] == -0.03  # the real variant keeps its tilt


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_vmaf_high_for_tilted_variant_quality_render(real_clip, tmp_path):
    src = probe(real_clip)
    params = _neutral_params()
    params["video"]["keystone_a"] = 0.03
    qr = quality.quality_render(src, params, str(tmp_path / "tilted.mp4"))
    assert quality.vmaf(real_clip, qr) > 85


def test_quality_render_keeps_source_frame_rate(monkeypatch, tmp_path):
    """out_fps (48/60) would double the proxy's frames; VMAF pairs frames by index."""
    captured = {}

    def fake_render(src, params, platform, path, dry_run=False):
        captured["video"] = dict(params["video"])
        open(path, "w").close()
        return path, "cmd"

    monkeypatch.setattr(ffmpeg, "render_variant", fake_render)
    src = SourceInfo(
        "in.mp4", "abc", 4.0, 1080, 1920, 30.0, True,
        ColorTags("tv", "bt709", "bt709", "bt709"),
    )
    params = _neutral_params()
    params["video"]["out_fps"] = 60
    quality.quality_render(src, params, str(tmp_path / "qr.mp4"))
    assert captured["video"]["out_fps"] is None
    assert params["video"]["out_fps"] == 60


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_signalstats_handles_video_starting_after_default_probe_window(tmp_path):
    """Audio can start >5s before video; movie must probe far enough to find its format."""
    path = str(tmp_path / "late video.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=7", "-itsoffset", "6",
         "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=10:duration=1",
         "-map", "1:v", "-map", "0:a", "-c:v", "libx264",
         "-pix_fmt", "yuv420p", "-c:a", "aac", path],
        check=True, capture_output=True,
    )
    luma, saturation = quality._signalstats(path)
    assert luma > 0
    assert saturation > 0
