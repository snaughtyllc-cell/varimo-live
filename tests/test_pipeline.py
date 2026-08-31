import json
import os
import subprocess

import pytest
from conftest import HAS_FFMPEG

from variant_maker import pipeline
from variant_maker.neural import upscale
from variant_maker.presets import MEDIUM, SUBTLE
from variant_maker.probe import probe
from variant_maker.uniqueness import DEFAULT_TARGET, FLOOR_BITS, MIN_PEER_BITS, TARGET_BITS


def test_default_uniqueness_target_is_24_bits():
    """Fast vs-source *gate* stays 24/64 (~38% UI). Do not raise it to 32.

    Medium talking-head should *score* ~35–42 bits (~55–65% UI) so packs clear
    without escalate. A 32-bit gate sat in strong's band and escalated all 20.
    Peer floor stays 24. Escalate remains for misses. Fast autotune is one
    medium encode then escalate — five-step bisection is how a 720 Fast 20
    hit executionTimeout.
    """
    assert TARGET_BITS == 24
    assert pipeline.DEFAULT_UNIQUENESS_TARGET == DEFAULT_TARGET
    assert pipeline.DEFAULT_UNIQUENESS_TARGET == 24 / 64
    assert FLOOR_BITS == 19
    assert pipeline.DEFAULT_MIN_BITS_VS_PEERS == MIN_PEER_BITS
    assert pipeline.DEFAULT_MIN_BITS_VS_PEERS == 24
    assert pipeline.FAST_TUNE_MAX_ITERS == 1
    assert pipeline.use_face_protect("fast") is False
    assert pipeline.use_face_protect("hq") is True


def test_apply_variant_policy_safe_rotate_and_optional_us_metadata():
    """Studio/CLI default is safe. never still zeros. US tags stay opt-in."""
    motion = {"video": {"rotate_deg": 0.1}, "audio": {}}
    pipeline._apply_variant_policy(motion, 99, MEDIUM, "motion", False, {"us_metadata": True})
    assert motion["video"]["rotate_deg"] == pytest.approx(0.7)
    assert motion["us_metadata"] is True
    assert motion["video"]["us_metadata_seed"] == 99

    head = {"video": {"rotate_deg": -2.0}, "audio": {}}
    pipeline._apply_variant_policy(head, 1, MEDIUM, "talking_head", False, {})
    assert head["video"]["rotate_deg"] == pytest.approx(-0.8)
    assert "us_metadata" not in head

    never = {"video": {"rotate_deg": 1.2}, "audio": {}}
    pipeline._apply_variant_policy(never, 1, MEDIUM, "motion", True, {})
    assert never["video"]["rotate_deg"] == 0.0

    subtle = {"video": {"rotate_deg": 0.0}, "audio": {}}
    pipeline._apply_variant_policy(subtle, 1, SUBTLE, "motion", False, {})
    assert subtle["video"]["rotate_deg"] == 0.0


# Live CLI does not grow --us-metadata in this promote. Engine policy is tested above.


HAS_RESR = upscale.available("models/realesrgan")


def _short_clip(real_clip, tmp_path):
    # 1s — long enough that the sampled trim leaves a representative chunk for the
    # source-vs-variant histogram comparison (a 0.3s clip gets gutted by a ~0.23s trim).
    out = str(tmp_path / "short.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", real_clip, "-t", "1.0", out],
                   check=True, capture_output=True)
    return out


def _config(real_clip, out, **ov):
    cfg = {
        "input": real_clip, "count": 2, "preset": "medium", "platform": "reels",
        "quality_mode": "fast", "seed": 12345, "out": out, "quality_floor": 90.0,
        "max_regen": 3, "rotate": "never", "flip": "never", "jobs": 1,
        "dry_run": False, "verbose": False,
    }
    cfg.update(ov)
    return cfg


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_produces_variants_and_manifest(real_clip, tmp_path):
    out = str(tmp_path / "out")
    m = pipeline.run(_config(real_clip, out, count=2))

    mpath = os.path.join(out, "manifest.json")
    assert os.path.exists(mpath)
    data = json.load(open(mpath))

    assert len(data["variants"]) == 2
    for v in data["variants"]:
        assert v["platform_result"] is None          # the detector bridge stays honest
        assert v["ffmpeg_cmd"].startswith("ffmpeg")
        assert v["output_sha256"]
        assert v["quality"]["passed"] is True
        assert os.path.exists(os.path.join(out, v["filename"]))

    assert data["run"]["master_seed"] == 12345
    assert data["run"]["preset"] == "medium" and data["run"]["platform"] == "reels"
    assert data["run"]["ffmpeg_version"]                # Codex #8: pin the encoder version
    assert data["source"]["sha256"] == probe(real_clip).sha256
    assert m.variants[0].filename == data["variants"][0]["filename"]


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_filenames_are_reproducible(real_clip, tmp_path):
    m1 = pipeline.run(_config(real_clip, str(tmp_path / "a"), count=1))
    m2 = pipeline.run(_config(real_clip, str(tmp_path / "b"), count=1))
    assert [v.filename for v in m1.variants] == [v.filename for v in m2.variants]


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_dry_run_renders_nothing(real_clip, tmp_path):
    out = str(tmp_path / "dry")
    m = pipeline.run(_config(real_clip, out, dry_run=True, count=2))

    assert not os.path.exists(os.path.join(out, "manifest.json"))
    if os.path.isdir(out):
        assert [f for f in os.listdir(out) if f.endswith(".mp4")] == []
    assert len(m.variants) == 2
    assert all(v.ffmpeg_cmd.startswith("ffmpeg") for v in m.variants)


@pytest.mark.integration
@pytest.mark.skipif(not (HAS_FFMPEG and HAS_RESR), reason="needs ffmpeg + realesrgan")
def test_pipeline_hq_uses_neural_upscale(real_clip, tmp_path):
    clip = _short_clip(real_clip, tmp_path)
    out = str(tmp_path / "out")
    m = pipeline.run(_config(clip, out, count=1, quality_mode="hq", platform="reels", seed=7))

    v = m.variants[0]
    assert v.tier == 2
    assert v.neural_ops and v.neural_ops[0]["op"] == "upscale"
    assert "sat_match" in v.neural_ops[0]           # measured saturation correction recorded
    info = probe(os.path.join(out, v.filename))
    assert info.has_audio                           # audio survived the frame round-trip
    assert info.width == 1080 and info.height == 1920

    # the measured saturation match keeps neural color in band -> guard passes without regens
    assert v.quality["histogram_ok"] is True
    assert v.quality["regen_count"] == 0
    assert v.quality["passed"] is True


def _fake_upscale(spatial_vmaf):
    """Stand in for upscale_clip: produce a real (cheap) file so probe/histogram work,
    but report a chosen spatial-coherence score — lets us exercise the corruption guard
    without the slow neural binary."""
    from variant_maker import ffmpeg

    def _impl(src, params, out_path, *, platform, **kw):
        ffmpeg.render_variant(src, params, platform, out_path)
        ops = [{"op": "upscale", "model": "fake", "scale": 4, "spatial_vmaf": spatial_vmaf}]
        return out_path, "fake-cmd", ops

    return _impl


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_marks_corrupt_when_spatial_guard_fails(real_clip, tmp_path, monkeypatch):
    """A garbled upscale (low hq-vs-pre-upscale VMAF) is flagged corrupt, NOT silently shipped."""
    import variant_maker.neural.upscale as up
    monkeypatch.setattr(up, "available", lambda *a, **k: True)
    monkeypatch.setattr(up, "upscale_clip", _fake_upscale(spatial_vmaf=12.0))

    out = str(tmp_path / "out")
    m = pipeline.run(_config(real_clip, out, count=1, quality_mode="hq",
                             platform="reels", corruption_floor=60.0))
    v = m.variants[0]
    assert v.tier == 2
    assert v.quality["spatial_vmaf"] == 12.0
    assert v.quality["spatial_ok"] is False
    assert v.status == "corrupt"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_spatial_guard_passes_clean_upscale(real_clip, tmp_path, monkeypatch):
    import variant_maker.neural.upscale as up
    monkeypatch.setattr(up, "available", lambda *a, **k: True)
    monkeypatch.setattr(up, "upscale_clip", _fake_upscale(spatial_vmaf=96.0))

    out = str(tmp_path / "out")
    m = pipeline.run(_config(real_clip, out, count=1, quality_mode="hq",
                             platform="reels", corruption_floor=60.0))
    v = m.variants[0]
    assert v.quality["spatial_ok"] is True
    assert v.status != "corrupt"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_tier1_has_no_spatial_metric(real_clip, tmp_path):
    """Fast tier never runs the upscaler -> no tile-seam risk -> spatial fields are N/A."""
    out = str(tmp_path / "out")
    m = pipeline.run(_config(real_clip, out, count=1, quality_mode="fast"))
    v = m.variants[0]
    assert v.quality["spatial_vmaf"] is None
    assert v.quality["spatial_ok"] is None


@pytest.mark.integration
@pytest.mark.skipif(not (HAS_FFMPEG and HAS_RESR), reason="needs ffmpeg + realesrgan")
def test_pipeline_hq_records_real_spatial_vmaf(real_clip, tmp_path):
    clip = _short_clip(real_clip, tmp_path)
    out = str(tmp_path / "out")
    m = pipeline.run(_config(clip, out, count=1, quality_mode="hq", platform="reels", seed=7))
    v = m.variants[0]
    assert v.neural_ops[0]["spatial_vmaf"] > 60          # the native-scale fix is coherent
    assert v.quality["spatial_ok"] is True
    assert v.status != "corrupt"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_pipeline_hq_falls_back_when_upscaler_absent(real_clip, tmp_path, monkeypatch):
    import variant_maker.neural.upscale as up
    monkeypatch.setattr(up, "available", lambda *a, **k: False)
    out = str(tmp_path / "out")
    m = pipeline.run(_config(real_clip, out, count=1, quality_mode="hq", platform="none"))
    assert m.variants[0].tier == 1
    assert m.variants[0].neural_ops == []


@pytest.mark.integration
@pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")
def test_cli_dry_run_smoke(real_clip):
    from click.testing import CliRunner
    from variant_maker.cli import main

    res = CliRunner().invoke(
        main, [real_clip, "--dry-run", "-n", "1", "--platform", "reels", "--seed", "1"]
    )
    assert res.exit_code == 0, res.output
    assert "ffmpeg" in res.output
