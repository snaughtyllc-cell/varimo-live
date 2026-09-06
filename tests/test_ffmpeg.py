import subprocess

import pytest

from variant_maker import ffmpeg
from variant_maker.probe import ColorTags, SourceInfo, probe
from variant_maker.platforms import SOCIAL_BUFSIZE, SOCIAL_MAXRATE, get_platform
from variant_maker.sampler import derive_seed, sample
from variant_maker.presets import MEDIUM
from conftest import HAS_FFMPEG, mean_saturation

REELS = get_platform("reels")


def make_src(has_audio=True, color=None):
    color = color or ColorTags("tv", "bt709", "bt709", "bt709")
    return SourceInfo("in.mp4", "abc", 10.0, 1080, 1920, 30.0, has_audio, color)


def make_params(**v):
    video = {
        "crop_keep": 0.96, "rotate_deg": 0.0, "brightness": 0.0, "contrast": 1.0,
        "saturation": 1.0, "gamma": 1.0, "hue_deg": 0.0, "grain": 0.0, "unsharp": 0.0,
        "speed": 1.0, "trim_s": 0.0, "crf": 21, "gop": 60,
    }
    video.update(v)
    audio = {"speed": 1.0, "loudnorm_i": -14.0, "eq_bands": 1, "eq_gains": [0.0],
             "pitch_pct": 0.0, "aac_kbps": 160}
    return {"video": video, "audio": audio}


def _sublist(needle, haystack):
    return any(haystack[i:i + len(needle)] == needle for i in range(len(haystack)))


# ---- pure command builder ---------------------------------------------------

def test_cmd_has_color_metadata_and_codec_flags():
    cmd = ffmpeg.build_render_cmd(make_src(), make_params(), REELS, "out.mp4")
    assert cmd[0] == "ffmpeg" and cmd[-1] == "out.mp4"
    assert _sublist(["-i", "in.mp4"], cmd)
    assert _sublist(["-map_metadata", "-1"], cmd)
    assert _sublist(["-fflags", "+bitexact"], cmd)
    assert _sublist(["-c:v", "libx264"], cmd)
    assert _sublist(["-crf", "21"], cmd)
    assert _sublist(["-g", "60"], cmd)
    assert _sublist(["-pix_fmt", "yuv420p"], cmd)
    # explicit output color tagging (the wash-out fix carried to the encoder)
    assert _sublist(["-color_range", "tv"], cmd)
    assert _sublist(["-colorspace", "bt709"], cmd)
    # Constrained VBR: CRF still picks quality; maxrate stops grain bombs (~60 Mbps).
    assert _sublist(["-maxrate", SOCIAL_MAXRATE], cmd)
    assert _sublist(["-bufsize", SOCIAL_BUFSIZE], cmd)
    assert "-b:v" not in cmd


def test_cmd_does_not_cap_bitrate_on_none_platform():
    none = get_platform("none")
    cmd = ffmpeg.build_render_cmd(make_src(), make_params(), none, "out.mp4")
    assert _sublist(["-crf", "21"], cmd)
    assert "-maxrate" not in cmd
    assert "-bufsize" not in cmd


def test_cmd_wires_audio_when_present():
    cmd = ffmpeg.build_render_cmd(make_src(has_audio=True), make_params(), REELS, "out.mp4")
    assert _sublist(["-c:a", "aac"], cmd)
    assert _sublist(["-b:a", "160k"], cmd)
    assert _sublist(["-map", "0:v:0"], cmd)
    assert _sublist(["-map", "0:a:0"], cmd)
    assert "-af" in cmd and "-an" not in cmd


def test_cmd_omits_empty_audio_filter_but_keeps_aac():
    """Voice-safe + identity tempo must not pass -af ''. ffmpeg 6 exits 234."""
    audio = {
        "speed": 1.0, "loudnorm_i": None, "eq_bands": 1, "eq_gains": [0.0],
        "pitch_pct": 0.0, "aac_kbps": 160,
    }
    params = make_params()
    params["audio"] = audio
    cmd = ffmpeg.build_render_cmd(make_src(has_audio=True), params, REELS, "out.mp4")
    assert "-af" not in cmd
    assert _sublist(["-c:a", "aac"], cmd)
    assert _sublist(["-map", "0:a:0"], cmd)
    assert "-an" not in cmd


def test_cmd_drops_audio_when_absent():
    cmd = ffmpeg.build_render_cmd(make_src(has_audio=False), make_params(), REELS, "out.mp4")
    assert "-an" in cmd
    assert "-af" not in cmd and "-c:a" not in cmd
    assert _sublist(["-map", "0:v:0"], cmd)
    assert not _sublist(["-map", "0:a:0"], cmd)


def test_cmd_uses_filter_complex_for_chroma_cloud():
    from dataclasses import replace

    canvas = replace(REELS, width=720, height=1280)
    src = SourceInfo("in.mp4", "abc", 10.0, 720, 1280, 30.0, True, ColorTags("tv", "bt709", "bt709", "bt709"))
    cmd = ffmpeg.build_render_cmd(
        src,
        make_params(grain=40.0, noise_chroma=True, noise_seed=7, chroma_cloud=20),
        canvas,
        "out.mp4",
    )
    assert "-filter_complex" in cmd
    assert "-vf" not in cmd
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "split[main][s]" in graph
    assert graph.endswith("[v]")
    assert _sublist(["-map", "[v]"], cmd)
    assert _sublist(["-map", "0:a:0"], cmd)
    assert "-af" in cmd


def test_cmd_keeps_vf_without_chroma_cloud():
    cmd = ffmpeg.build_render_cmd(make_src(), make_params(), REELS, "out.mp4")
    assert "-vf" in cmd
    assert "-filter_complex" not in cmd


def test_has_rubberband_true_when_filter_listed(monkeypatch):
    ffmpeg._rubberband_cached = None

    def fake_run(cmd, **kwargs):
        listing = (
            "Filters:\n"
            " ..C atempo            A->A       Adjust audio tempo.\n"
            " ..C rubberband        A->A       Time-stretch and pitch-shift audio.\n"
        )
        return subprocess.CompletedProcess(cmd, 0, stdout=listing, stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    assert ffmpeg.has_rubberband() is True
    assert ffmpeg._rubberband_cached is True


def test_has_rubberband_false_when_filter_absent(monkeypatch):
    ffmpeg._rubberband_cached = None

    def fake_run(cmd, **kwargs):
        listing = (
            "Filters:\n"
            " ..C atempo            A->A       Adjust audio tempo.\n"
            " ..C loudnorm          A->A       EBU R128 loudness normalization.\n"
        )
        return subprocess.CompletedProcess(cmd, 0, stdout=listing, stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    assert ffmpeg.has_rubberband() is False
    assert ffmpeg._rubberband_cached is False


def test_has_rubberband_false_when_ffmpeg_missing(monkeypatch):
    ffmpeg._rubberband_cached = None

    def fake_run(cmd, **kwargs):
        raise FileNotFoundError("ffmpeg")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    assert ffmpeg.has_rubberband() is False


def test_has_rubberband_uses_cached_result(monkeypatch):
    ffmpeg._rubberband_cached = True
    calls = {"n": 0}

    def fake_run(cmd, **kwargs):
        calls["n"] += 1
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg.subprocess, "run", fake_run)
    assert ffmpeg.has_rubberband() is True
    assert calls["n"] == 0


def test_render_variant_dry_run_returns_cmd_without_running():
    out, cmd_str = ffmpeg.render_variant(make_src(), make_params(), REELS, "out.mp4", dry_run=True)
    assert out == "out.mp4"
    assert cmd_str.startswith("ffmpeg") and "libx264" in cmd_str


# ---- integration: render a real variant -------------------------------------

def _probe_streams(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True,
    )
    import json
    return json.loads(out.stdout)


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_render_preserves_color_on_real_footage(real_clip, tmp_path):
    """Phase-5 acceptance: the full render path keeps saturation (no wash-out) and even dims."""
    src = probe(real_clip)
    out = str(tmp_path / "variant.mp4")
    params = make_params()  # color-neutral: isolates the render path's color correctness
    ffmpeg.render_variant(src, params, REELS, out)

    info = _probe_streams(out)
    vid = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert vid["width"] == 1080 and vid["height"] == 1920
    assert vid["width"] % 2 == 0 and vid["height"] % 2 == 0
    src_sat, out_sat = mean_saturation(real_clip), mean_saturation(out)
    assert abs(out_sat - src_sat) / src_sat < 0.08, f"src={src_sat:.1f} out={out_sat:.1f}"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_render_real_variant_plays_with_audio_in_sync(real_clip, tmp_path):
    src = probe(real_clip)
    out = str(tmp_path / "variant.mp4")
    params = sample(MEDIUM, derive_seed(20260627, 1))
    _, cmd_str = ffmpeg.render_variant(src, params, REELS, out)

    info = _probe_streams(out)
    kinds = {s["codec_type"] for s in info["streams"]}
    assert "video" in kinds and "audio" in kinds
    vid = next(s for s in info["streams"] if s["codec_type"] == "video")
    aud = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert float(info["format"]["duration"]) > 1.0
    # video and audio trimmed/tempo'd identically -> durations track (gross-desync guard)
    assert abs(float(vid["duration"]) - float(aud["duration"])) < 0.3
    assert "libx264" in cmd_str
