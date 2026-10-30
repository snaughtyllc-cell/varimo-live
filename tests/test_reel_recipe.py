"""Fixed Reel copy table: ten rows, pitch, cover nudge, locked frame."""
import json
import os

import pytest

from variant_maker.filtergraph import build_audio_filters, build_video_filters
from variant_maker.platforms import get_platform
from variant_maker.probe import ColorTags, SourceInfo
from variant_maker.reel_copies import allocate
from variant_maker.reel_recipe import PITCH_SLOTS, UNSHARP, params_for_copy


def _src() -> SourceInfo:
    return SourceInfo(
        path="in.mp4", sha256="abc", duration_s=12.0, width=1080, height=1920,
        fps=30.0, has_audio=True,
        color=ColorTags(range="tv", primaries="bt709", transfer="bt709", matrix="bt709"),
    )


def test_copy_one_matches_the_first_row():
    p = params_for_copy(1, duration_s=12.0, rubberband=True)
    v, a = p["video"], p["audio"]
    assert v["speed"] == 1.00
    assert v["crop_keep"] == 1.0
    assert v["hue_deg"] == 0.0
    assert v["saturation"] == 1.00
    assert v["trim_s"] == 0.0
    assert v["trim_end_s"] == 0.0
    assert v["crf"] == 18
    assert v["out_fps"] == 30
    assert v["unsharp"] == UNSHARP
    assert a["speed"] == v["speed"]
    assert a["pitch_pct"] == pytest.approx(-1.5)
    assert a["loudnorm_i"] is None
    assert a["eq_gains"] == []


def test_rows_repeat_with_a_hue_step_and_a_new_pitch():
    first = params_for_copy(1, rubberband=True)
    eleventh = params_for_copy(11, rubberband=True)
    assert eleventh["video"]["speed"] == first["video"]["speed"]
    assert eleventh["video"]["hue_deg"] == pytest.approx(0.2)
    assert eleventh["audio"]["pitch_pct"] != first["audio"]["pitch_pct"]
    assert eleventh["video"]["trim_s"] > first["video"]["trim_s"]


def test_pitch_and_cover_are_unique_for_the_first_200_copies():
    pitches = [params_for_copy(n, rubberband=True)["audio"]["pitch_pct"] for n in range(1, 201)]
    assert len({round(p, 6) for p in pitches}) == PITCH_SLOTS
    assert min(pitches) == pytest.approx(-1.5)
    assert max(pitches) == pytest.approx(1.5)
    assert params_for_copy(201, rubberband=True)["audio"]["pitch_pct"] == pytest.approx(pitches[0])


def test_speed_stays_on_the_row():
    assert params_for_copy(5)["video"]["speed"] == 0.95
    assert params_for_copy(4)["video"]["speed"] == 1.05
    assert params_for_copy(15)["video"]["speed"] == 0.95


def test_sharpen_zoom_and_stillness_are_fixed():
    for n in (1, 2, 10, 11):
        v = params_for_copy(n)["video"]
        assert v["unsharp"] == UNSHARP
        assert v["grain"] == 0.0
        assert v["rotate_deg"] == 0.0
        assert v["keystone_a"] == 0.0
        assert v["vignette"] == 0.0
        assert v["warp_k1"] == 0.0
        assert v["rebuild_scale"] == 1.0
        assert v["crop_hand_amp_x"] == 0.0
    zoomed = params_for_copy(10)["video"]
    assert zoomed["crop_keep"] == pytest.approx(1.0 / 1.03)


def test_pitch_stays_off_without_rubberband():
    assert params_for_copy(4, rubberband=False)["audio"]["pitch_pct"] == 0.0


def test_filtergraph_locks_30fps_and_skips_the_heavy_moves():
    src = _src()
    platform = get_platform("reels")
    vf1 = build_video_filters(params_for_copy(1, duration_s=12, rubberband=True), src, platform)
    vf2 = build_video_filters(params_for_copy(2, duration_s=12, rubberband=True), src, platform)
    af2 = build_audio_filters(params_for_copy(2, duration_s=12, rubberband=True), src, True)
    assert "fps=30" in vf1 and "fps=48" not in vf1 and "fps=60" not in vf1
    assert "unsharp=5:5:0.3000" in vf1
    assert "unsharp=5:5:0.3000" in vf2
    for token in ("noise=", "vignette", "lenscorrection", "rotate=", "perspective="):
        assert token not in vf2
    assert "flags=" not in vf2
    assert "setpts=" in vf2
    assert "atempo=1.030000" in af2
    assert "rubberband=pitch=" in af2
    assert "equalizer=" not in af2
    assert "loudnorm=" not in af2
    assert "hue=h=2.0000" in vf2


def test_copy_number_must_start_at_one():
    with pytest.raises(ValueError):
        params_for_copy(0)


def test_dry_run_uses_the_table_and_does_not_hunt(sample_clip, tmp_path):
    from variant_maker import pipeline

    manifest = pipeline.run({
        "input": sample_clip,
        "out": str(tmp_path),
        "count": 2,
        "preset": "medium",
        "platform": "reels",
        "quality_mode": "fast",
        "reel_recipe": True,
        "copy_start": 11,
        "rubberband": True,
        "dry_run": True,
        "auto_tune": True,
        "allow_creative_escalate": True,
        "seed": 1,
    })
    assert manifest.run["reel_recipe"] is True
    assert manifest.run["auto_tune"] is False
    assert manifest.run["copy_start"] == 11
    first, second = manifest.variants
    assert first.params["video"]["speed"] == 1.00
    assert first.params["video"]["hue_deg"] == pytest.approx(0.2)
    assert second.params["video"]["speed"] == 1.03
    assert "scale=1920:1080" in first.ffmpeg_cmd
    assert "noise=" not in second.ffmpeg_cmd
    assert "perspective=" not in second.ffmpeg_cmd
    assert "-crf 18" in first.ffmpeg_cmd
    assert "rubberband=" in second.ffmpeg_cmd
    assert "fps=30" in second.ffmpeg_cmd


def test_copy_start_reaches_the_local_runner(monkeypatch, tmp_path):
    from variant_maker.reel_copies import reset_copy_start, set_copy_start
    from variant_maker.server import runner as runner_mod
    from variant_maker.server.runner import LocalRunner

    captured = {}

    def fake_run(config, *, on_event=None):
        captured.update(config)
        open(os.path.join(config["out"], "manifest.json"), "w").close()

        class Manifest:
            def __init__(self):
                self.variants = []

        return Manifest()

    monkeypatch.setattr(runner_mod.pipeline, "run", fake_run)
    token = set_copy_start(47)
    try:
        LocalRunner().run(
            "src.mp4", count=2, out_dir=str(tmp_path), source_id="s",
            on_event=lambda _event: None,
        )
    finally:
        reset_copy_start(token)
    assert captured["copy_start"] == 47
    assert captured["reel_recipe"] is True


def test_job_encode_continues_copy_numbers(tmp_path):
    from variant_maker.reel_copies import get_copy_start
    from variant_maker.server.jobs import JobStore
    from variant_maker.server.runner import SourceResult
    from variant_maker.server.workspace import Workspace

    seen: list[int | None] = []

    class Recorder:
        def run(self, source_path, *, count, out_dir, source_id, on_event,
                allow_creative_escalate, quality_mode, cancel_token):
            del source_path, count, out_dir, source_id, on_event
            del allow_creative_escalate, quality_mode, cancel_token
            seen.append(get_copy_start())
            return SourceResult(variants=[], manifest_path="")

    src = tmp_path / "clip.mp4"
    src.write_bytes(b"same-bytes")
    store = JobStore(Workspace(str(tmp_path / "ws")), Recorder())

    def encode() -> None:
        store._encode_source(
            str(src), count=8, out_dir=str(tmp_path / "out"), source_id="s",
            on_event=lambda _event: None, allow_creative_escalate=True,
            quality_mode="fast", cancel_token=None,
        )

    encode()
    encode()
    assert seen == [1, 9]


def test_allocate_continues_per_source(tmp_path):
    root = str(tmp_path)
    assert allocate(root, "aaa", 8) == 1
    assert allocate(root, "aaa", 2) == 9
    assert allocate(root, "bbb", 1) == 1
    saved = json.loads((tmp_path / "reel_copies.json").read_text())
    assert saved["aaa"] == 11
    assert saved["bbb"] == 2
