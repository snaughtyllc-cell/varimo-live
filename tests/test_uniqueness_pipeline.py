"""pipeline.run's uniqueness gate: light preset at rising strengths, one creative
escalate to the strong preset if none of them clear the target. ffmpeg/probe/uniqueness
are monkeypatched so this runs as a fast unit test."""
from __future__ import annotations

import threading
import time

from variant_maker import pipeline
from variant_maker.uniqueness import DEFAULT_TARGET


class FakeSrc:
    path = "src.mp4"
    sha256 = "deadbeef"
    duration_s = 1.0
    width = 1080
    height = 1920

    def to_dict(self):
        return {"path": self.path, "sha256": self.sha256, "width": self.width, "height": self.height}


def _stub_common(monkeypatch):
    monkeypatch.setattr(pipeline, "probe", lambda p: FakeSrc())
    monkeypatch.setattr(pipeline, "_ffmpeg_version", lambda: "test")
    monkeypatch.setattr(pipeline, "sample", lambda preset, seed, **_kw: {
        "video": {"rotate_deg": 0.0}, "audio": {},
    })

    def fake_render(src, params, platform, path, dry_run=False):
        open(path, "w").close()
        return (path, "ffmpeg -y fake")
    monkeypatch.setattr(pipeline, "render_variant", fake_render)

    monkeypatch.setattr(
        pipeline.quality, "quality_render",
        lambda src, params, qr: open(qr, "w").close(),
    )
    # Quality always passes — isolates the uniqueness-gate control flow.
    monkeypatch.setattr(
        pipeline.quality, "passes_guard",
        lambda src_path, variant_path, qr, floor=90.0: {
            "vmaf": 95.0, "histogram_ok": True, "passed": True,
        },
    )
    # No peer distance by default (first / only variant).
    monkeypatch.setattr(pipeline.uniqueness, "bits_vs", lambda a, b: 64)
    monkeypatch.setattr(
        pipeline.look, "score_look",
        lambda src_path, variant_path, video=None: {
            "look_status": "ok", "look_metric": "coarse_luma_v1",
            "look_mae": 8.0, "look_mae_max": 10.0, "look_target": 38.0,
        },
    )
    monkeypatch.setattr(pipeline.look, "write_look_stills", lambda *a, **k: {
        "look_src": "look_v01_src.jpg", "look_var": "look_v01.jpg",
    })


def _ok_score(uniqueness=0.5, bits=32, status="ok", target=DEFAULT_TARGET):
    return {
        "uniqueness": uniqueness,
        "uniqueness_status": status,
        "uniqueness_metric": "ssim_bits_v1",
        "uniqueness_target": target,
        "bits": bits,
    }


def _cfg(tmp_path, **overrides):
    cfg = {
        "input": "src.mp4", "count": 1, "preset": "medium", "platform": "none",
        "out": str(tmp_path), "quality_mode": "fast", "jobs": 1, "max_regen": 3,
        "uniqueness_target": DEFAULT_TARGET,
        # Ladder tests pin this off. Product Fast defaults auto_tune on.
        "auto_tune": False,
    }
    cfg.update(overrides)
    return cfg


def test_escalates_to_strong_when_light_below_target(monkeypatch, tmp_path):
    _stub_common(monkeypatch)

    scores = iter([
        _ok_score(0.1, bits=6, status="below_target"),
        _ok_score(0.2, bits=12, status="below_target"),
        _ok_score(0.5, bits=32, status="ok"),
    ])
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: next(scores),
    )

    # Only 2 light-preset strengths configured; the 3rd mocked score ("ok") lands on
    # the one creative-escalate attempt at the strong preset.
    cfg = _cfg(tmp_path, uniq_strengths=[1.0, 1.25])
    manifest = pipeline.run(cfg)

    record = manifest.variants[0]
    assert record.escalated is True
    assert record.preset_used == "strong"
    assert record.uniqueness_status == "ok"
    assert record.uniqueness == 0.5


def test_keeps_light_preset_when_first_attempt_is_ok(monkeypatch, tmp_path):
    _stub_common(monkeypatch)

    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.6, bits=38),
    )

    cfg = _cfg(tmp_path)
    manifest = pipeline.run(cfg)

    record = manifest.variants[0]
    assert record.escalated is False
    assert record.preset_used == "medium"
    assert record.uniqueness_status == "ok"


def test_score_look_receives_video_params(monkeypatch, tmp_path):
    """Crop/trim MAE needs the variant's sampled video dict, including auto-tune."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(pipeline, "sample", lambda preset, seed, **_kw: {
        "video": {
            "crop_keep": 0.90, "crop_x_frac": 0.5, "crop_y_frac": 0.5,
            "rotate_deg": 0.0,
        },
        "audio": {},
    })
    seen: dict = {}

    def fake_look(src_path, variant_path, video=None):
        seen["video"] = video
        return {
            "look_status": "ok", "look_metric": "coarse_luma_v1",
            "look_mae": 8.0, "look_mae_max": 10.0, "look_target": 38.0,
        }

    monkeypatch.setattr(pipeline.look, "score_look", fake_look)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.6, bits=38),
    )
    pipeline.run(_cfg(tmp_path))
    assert seen.get("video") is not None
    assert seen["video"]["crop_keep"] == 0.90


def test_look_fail_skips_escalate(monkeypatch, tmp_path):
    """lookaqmtp-class blotch must not escalate. Keep the medium file."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(
        pipeline.look, "score_look",
        lambda src_path, variant_path, video=None: {
            "look_status": "fail", "look_metric": "coarse_luma_v1",
            "look_mae": 50.0, "look_mae_max": 57.0, "look_target": 38.0,
        },
    )
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            0.1, bits=6, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=True)
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert record.escalated is False
    assert record.preset_used == "medium"
    assert record.look_status == "fail"
    assert record.uniqueness_status == "below_floor"
    assert record.status == "uniqueness_fail"


def test_escalate_look_fail_keeps_medium(monkeypatch, tmp_path):
    """Strong blotch after a look-ok medium must not replace the medium file."""
    _stub_common(monkeypatch)
    looks = iter([
        {
            "look_status": "ok", "look_metric": "coarse_luma_v1",
            "look_mae": 20.0, "look_mae_max": 22.0, "look_target": 38.0,
        },
        {
            "look_status": "fail", "look_metric": "coarse_luma_v1",
            "look_mae": 40.0, "look_mae_max": 51.0, "look_target": 38.0,
        },
    ])
    monkeypatch.setattr(
        pipeline.look, "score_look",
        lambda src_path, variant_path, video=None: next(looks),
    )
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            20 / 64, bits=20, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=True)
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert record.escalated is False
    assert record.preset_used == "medium"
    assert record.look_status == "ok"
    assert record.uniqueness_status == "below_target"
    assert record.status == "ok"
    assert record.uniqueness == 20 / 64


def test_stays_below_target_when_escalate_disabled(monkeypatch, tmp_path):
    """Advanced off: 19–23 bits ship without a strong pass. Product Fast still hunts 24."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            20 / 64, bits=20, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert record.escalated is False
    assert record.preset_used == "medium"
    assert record.uniqueness_status == "below_target"
    assert record.status == "ok"


def test_twenty_bits_on_first_pass_still_escalates(monkeypatch, tmp_path):
    """19-bit floor is not a first-pass shortcut. 20 bits still hunts 24 via strong."""
    _stub_common(monkeypatch)
    n = {"scores": 0}

    def fake_score(src_path, variant_path, target=None):
        n["scores"] += 1
        if n["scores"] == 1:
            return _ok_score(20 / 64, bits=20, status="below_target")
        return _ok_score(24 / 64, bits=24, status="ok")

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)
    cfg = _cfg(tmp_path, allow_creative_escalate=True)
    del cfg["auto_tune"]
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert n["scores"] == 2
    assert record.escalated is True
    assert record.preset_used == "strong"
    assert record.uniqueness_status == "ok"
    assert record.status == "ok"
    assert record.uniqueness == 24 / 64


def test_nineteen_after_escalate_ships(monkeypatch, tmp_path):
    """Only after the 24-bit hunt: 19 bits (~30%) still ships as below_target."""
    _stub_common(monkeypatch)
    n = {"scores": 0}

    def fake_score(src_path, variant_path, target=None):
        n["scores"] += 1
        if n["scores"] == 1:
            return _ok_score(20 / 64, bits=20, status="below_target")
        return _ok_score(19 / 64, bits=19, status="below_target")

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)
    cfg = _cfg(tmp_path, allow_creative_escalate=True)
    del cfg["auto_tune"]
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert n["scores"] == 2
    assert record.escalated is True
    assert record.preset_used == "strong"
    assert record.uniqueness_status == "below_target"
    assert record.status == "ok"
    assert record.uniqueness == 19 / 64


def test_below_floor_does_not_ship_as_ok(monkeypatch, tmp_path):
    """Under 19 bits (~30%) is uniqueness_fail — not a Drive/gallery ready file."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            12 / 64, bits=12, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert record.uniqueness_status == "below_floor"
    assert record.status == "uniqueness_fail"


def test_nineteen_bits_still_ships_as_ok(monkeypatch, tmp_path):
    """19 bits (~30% UI) after the hunt (or with escalate off) is still a Drive file."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            19 / 64, bits=19, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    manifest = pipeline.run(cfg)
    record = manifest.variants[0]
    assert record.uniqueness_status == "below_target"
    assert record.status == "ok"
    assert record.uniqueness == 19 / 64


def test_look_first_one_encode_no_escalate(monkeypatch, tmp_path):
    """CLI --look-first: one medium copy + stills, no uniqueness hunt."""
    _stub_common(monkeypatch)
    seen = []

    def spy_sample(preset, seed, **kwargs):
        seen.append(preset.name)
        return {"video": {"rotate_deg": 0.0}, "audio": {}}

    monkeypatch.setattr(pipeline, "sample", spy_sample)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            0.1, bits=6, status="below_target",
        ),
    )
    cfg = _cfg(tmp_path, count=8, look_first=True, allow_creative_escalate=True)
    manifest = pipeline.run(cfg)
    assert len(manifest.variants) == 1
    record = manifest.variants[0]
    assert record.escalated is False
    assert record.preset_used == "medium"
    assert record.look_status == "ok"
    assert seen == ["medium"]


def test_uniq_strengths_are_not_collapsed_to_the_same_effective_value(monkeypatch, tmp_path):
    """Task 3 regression: uniq_strengths=[1.0, 1.25, 1.5] used to all clamp to 1.0 inside
    sample(), so escalating rungs rendered identical params for no extra uniqueness spend.
    Assert `sample` actually receives three distinct strengths, and `strength_final` on the
    record reflects the effective (post-clamp) value that was really used."""
    _stub_common(monkeypatch)
    seen_strengths = []
    real_sample = pipeline.sample

    def spy_sample(preset, seed, **kwargs):
        seen_strengths.append(kwargs.get("strength", 1.0))
        return real_sample(preset, seed, **kwargs)
    monkeypatch.setattr(pipeline, "sample", spy_sample)

    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            0.1, bits=6, status="below_target",
        ),
    )

    cfg = _cfg(tmp_path, uniq_strengths=[1.0, 1.25, 1.5], allow_creative_escalate=False)
    manifest = pipeline.run(cfg)

    # All three ladder rungs actually ran (no target ever met) at three DISTINCT
    # effective strengths — none of them collapsed onto 1.0.
    assert seen_strengths == [1.0, 1.25, 1.5]
    assert len(set(seen_strengths)) == 3

    record = manifest.variants[0]
    assert record.strength_final == 1.5


def test_duplicate_effective_strength_rung_is_skipped(monkeypatch, tmp_path):
    """Belt-and-suspenders: if two configured ladder rungs clamp to the SAME effective
    strength (e.g. both above the 2.0 hard cap), the second must be skipped rather than
    re-rendering identical params."""
    _stub_common(monkeypatch)
    seen_strengths = []
    real_sample = pipeline.sample

    def spy_sample(preset, seed, **kwargs):
        seen_strengths.append(kwargs.get("strength", 1.0))
        return real_sample(preset, seed, **kwargs)
    monkeypatch.setattr(pipeline, "sample", spy_sample)

    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(
            0.1, bits=6, status="below_target",
        ),
    )

    # 2.5 and 3.0 both clamp to the 2.0 hard cap -> identical effective strength.
    cfg = _cfg(tmp_path, uniq_strengths=[2.5, 3.0], allow_creative_escalate=False)
    manifest = pipeline.run(cfg)

    assert seen_strengths == [2.0]  # the duplicate rung never rendered

    record = manifest.variants[0]
    assert record.strength_final == 2.0


def test_emits_uniqueness_and_escalating_states(monkeypatch, tmp_path):
    _stub_common(monkeypatch)

    scores = iter([
        _ok_score(0.1, bits=6, status="below_target"),
        _ok_score(0.5, bits=32, status="ok"),
    ])
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: next(scores),
    )

    events = []
    cfg = _cfg(tmp_path, uniq_strengths=[1.0])
    pipeline.run(cfg, on_event=lambda state, **kw: events.append(state))

    assert events == [
        "rendering", "checking", "looking", "uniqueness",
        "escalating", "rendering", "checking", "looking", "uniqueness",
        "done",
    ]


def test_uniqueness_work_starts_before_stills_finish(monkeypatch, tmp_path):
    """Stills are a side channel. Uniqueness must not wait for JPEGs."""
    _stub_common(monkeypatch)
    uniq_started = threading.Event()
    stills_entered = threading.Event()

    def fake_stills(*_a, **_k):
        stills_entered.set()
        assert uniq_started.wait(timeout=1.0), "uniqueness thread must already be running"
        return {"look_src": "look_v01_src.jpg", "look_var": "look_v01.jpg"}

    def fake_uniq(_src, _variant, target=None):
        uniq_started.set()
        assert stills_entered.wait(timeout=1.0)
        return _ok_score()

    monkeypatch.setattr(pipeline.look, "write_look_stills", fake_stills)
    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_uniq)

    events: list[str] = []
    looking_kw: list[dict] = []

    def record(state, **kw):
        events.append(state)
        if state == "looking":
            looking_kw.append(kw)

    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    pipeline.run(cfg, on_event=record)
    assert events.index("looking") < events.index("uniqueness")
    assert looking_kw[0].get("look_src") == "look_v01_src.jpg"


def test_mae_runs_after_uniqueness_returns(monkeypatch, tmp_path):
    """Coarse MAE must not share the Fast CPU with 8-wide SSIM."""
    _stub_common(monkeypatch)
    uniq_done = threading.Event()
    order: list[str] = []

    def fake_uniq(_src, _variant, target=None):
        time.sleep(0.05)
        order.append("uniq")
        uniq_done.set()
        return _ok_score()

    def fake_mae(*_a, **_k):
        assert uniq_done.is_set()
        order.append("mae")
        return {
            "look_status": "ok", "look_metric": "coarse_luma_v1",
            "look_mae": 8.0, "look_mae_max": 10.0, "look_target": 38.0,
        }

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_uniq)
    monkeypatch.setattr(pipeline.look, "score_look", fake_mae)

    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    pipeline.run(cfg)
    assert order == ["uniq", "mae"]


def test_look_overlap_wall_clock_is_max_not_sum(monkeypatch, tmp_path):
    """Generate wait stays uniqueness-bound: stills overlap SSIM. MAE is after."""
    _stub_common(monkeypatch)
    started = threading.Barrier(2, timeout=2)
    slice_s = 0.18
    t_start: dict[str, float] = {}
    t_end: dict[str, float] = {}

    def slow_stills(*_a, **_k):
        started.wait()
        t_start["stills"] = time.perf_counter()
        time.sleep(slice_s)
        t_end["stills"] = time.perf_counter()
        return {"look_src": "look_v01_src.jpg", "look_var": "look_v01.jpg"}

    def slow_uniq(_src, _variant, target=None):
        started.wait()
        t_start["uniq"] = time.perf_counter()
        time.sleep(slice_s)
        t_end["uniq"] = time.perf_counter()
        return _ok_score()

    monkeypatch.setattr(pipeline.look, "write_look_stills", slow_stills)
    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", slow_uniq)

    cfg = _cfg(tmp_path, uniq_strengths=[1.0], allow_creative_escalate=False)
    pipeline.run(cfg)

    span = max(t_end.values()) - min(t_start.values())
    # Serial stills-then-uniqueness would be ~2 slices. Overlap is ~1.
    assert span < 1.7 * slice_s, span


def test_peer_bits_fail_forces_another_attempt(monkeypatch, tmp_path):
    """Same-batch diversity: source bits can pass while peer bits < min → treat as
    uniqueness fail and climb the ladder (TikFusion crossPasses)."""
    _stub_common(monkeypatch)

    # Two variants: v1 accepted first; v2 must clear peers.
    peer_calls = {"n": 0}

    def fake_bits_vs(a, b):
        peer_calls["n"] += 1
        # First uniqueness check for v2 vs v1 is too close; later attempt clears.
        return 4 if peer_calls["n"] == 1 else 16

    monkeypatch.setattr(pipeline.uniqueness, "bits_vs", fake_bits_vs)

    scores = iter([
        # v1 — ok, no peers
        _ok_score(0.5, bits=32, status="ok"),
        # v2 attempt 1 — source ok but peers will fail
        _ok_score(0.5, bits=32, status="ok"),
        # v2 attempt 2 — source ok and peers clear
        _ok_score(0.5, bits=32, status="ok"),
    ])
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: next(scores),
    )

    cfg = _cfg(
        tmp_path, count=2, uniq_strengths=[1.0, 1.4],
        allow_creative_escalate=False, min_bits_vs_peers=10,
    )
    manifest = pipeline.run(cfg)

    v1, v2 = manifest.variants
    assert v1.uniqueness_status == "ok"
    assert v2.uniqueness_status == "ok"
    assert v2.quality.get("min_bits_vs_peers") == 16
    # Two peer comparisons for v2 (failed then passed); v1 had none.
    assert peer_calls["n"] == 2
    assert v2.strength_final == 1.4


def test_auto_tune_peer_fail_escalates_instead_of_bisecting(monkeypatch, tmp_path):
    """v2 clears vs source but not vs v1 → one medium miss then strong, not five hunts."""
    _stub_common(monkeypatch)
    seen = []
    stub_sample = pipeline.sample

    def spy_sample(preset, seed, **kwargs):
        seen.append(preset.name)
        return stub_sample(preset, seed, **kwargs)

    monkeypatch.setattr(pipeline, "sample", spy_sample)

    peer_n = {"n": 0}

    def fake_bits_vs(a, b):
        peer_n["n"] += 1
        return 10 if peer_n["n"] == 1 else 30

    monkeypatch.setattr(pipeline.uniqueness, "bits_vs", fake_bits_vs)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )

    cfg = _cfg(tmp_path, count=2, auto_tune=True, allow_creative_escalate=True)
    manifest = pipeline.run(cfg)

    v1, v2 = manifest.variants
    assert v1.uniqueness_status == "ok"
    assert v1.escalated is False
    assert v2.escalated is True
    assert v2.preset_used == "strong"
    assert v2.quality.get("min_bits_vs_peers") == 30
    assert seen.count("medium") == 2  # v1 keeper + v2 miss
    assert seen.count("strong") == 1


def test_auto_tune_source_miss_escalates_on_second_encode(monkeypatch, tmp_path):
    """Fast daily: one medium uniqueness miss then strong — not five bisection encodes."""
    _stub_common(monkeypatch)
    n = {"scores": 0, "presets": []}

    def fake_sample(preset, seed, **kw):
        n["presets"].append(preset.name)
        return {"video": {"rotate_deg": 0.0}, "audio": {}}

    monkeypatch.setattr(pipeline, "sample", fake_sample)

    def fake_score(src_path, variant_path, target=None):
        n["scores"] += 1
        if n["scores"] == 1:
            return _ok_score(0.1, bits=6, status="below_target")
        return _ok_score(0.5, bits=32, status="ok")

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)

    cfg = _cfg(tmp_path, allow_creative_escalate=True)
    del cfg["auto_tune"]
    manifest = pipeline.run(cfg)

    record = manifest.variants[0]
    assert record.escalated is True
    assert record.preset_used == "strong"
    assert record.uniqueness_status == "ok"
    assert n["scores"] == 2
    assert n["presets"] == ["medium", "strong"]


def test_discarded_uniqueness_miss_skips_quality_render(monkeypatch, tmp_path):
    """VMAF on a medium encode we are about to throw away doubled Fast 20 wall time."""
    _stub_common(monkeypatch)
    n = {"qr": 0}

    def fake_qr(src, params, qr):
        n["qr"] += 1
        open(qr, "w").close()
        return qr

    monkeypatch.setattr(pipeline.quality, "quality_render", fake_qr)
    scores = iter([
        _ok_score(0.1, bits=6, status="below_target"),
        _ok_score(0.5, bits=32, status="ok"),
    ])
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: next(scores),
    )
    cfg = _cfg(tmp_path, allow_creative_escalate=True)
    del cfg["auto_tune"]
    pipeline.run(cfg)
    assert n["qr"] == 1


def test_hq_strips_fast_pixel_ops(monkeypatch, tmp_path):
    """ESRGAN already rebuilds pixels — resample/rebuild/warp must not ride the neural-pre render."""
    _stub_common(monkeypatch)
    seen = []

    def fake_upscale(src, params, path, platform=None):
        v = params["video"]
        seen.append((v.get("resample_px"), v.get("rebuild_scale"), v.get("warp_k1")))
        open(path, "w").close()
        return path, "cmd", []

    import variant_maker.neural.upscale as upscale_mod

    monkeypatch.setattr(upscale_mod, "available", lambda: True)
    monkeypatch.setattr(upscale_mod, "upscale_clip", fake_upscale)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )
    cfg = _cfg(tmp_path, quality_mode="hq", auto_tune=False, uniq_strengths=[1.0])
    pipeline.run(cfg)
    assert seen
    for px, rebuild, k1 in seen:
        assert px == 0
        assert rebuild == 1.0
        assert k1 == 0.0


def test_face_protect_is_hq_only():
    """Talking-head Fast uniqueness needs crop. Face-protect crop gating is HQ-only."""
    assert pipeline.use_face_protect("fast") is False
    assert pipeline.use_face_protect(None) is False
    assert pipeline.use_face_protect("hq") is True


def test_fast_does_not_grab_or_apply_face_protect(monkeypatch, tmp_path):
    """OpenCV on a Fast GPU fallback used to zero crop on talking-head → ~22 bits / all-esc."""
    _stub_common(monkeypatch)
    import variant_maker.neural.protect as protect_mod

    calls = {"grab": 0, "apply": 0}
    monkeypatch.setattr(protect_mod, "available", lambda: True)

    def grab(*_a, **_k):
        calls["grab"] += 1
        return "frame.png"

    def apply(params, **_k):
        calls["apply"] += 1
        video = dict(params.get("video") or {})
        video["crop_keep"] = 1.0
        return {**params, "video": video}

    monkeypatch.setattr(protect_mod, "grab_mid_frame", grab)
    monkeypatch.setattr(protect_mod, "apply_to_params", apply)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32),
    )

    pipeline.run(_cfg(tmp_path, quality_mode="fast", auto_tune=False, uniq_strengths=[1.0]))
    assert calls == {"grab": 0, "apply": 0}


def test_hq_still_grabs_and_applies_face_protect(monkeypatch, tmp_path):
    """HQ Real-ESRGAN still face-gates crop so reconstruct does not punch into faces."""
    _stub_common(monkeypatch)
    import variant_maker.neural.protect as protect_mod
    import variant_maker.neural.upscale as upscale_mod

    calls = {"grab": 0, "apply": 0}
    monkeypatch.setattr(protect_mod, "available", lambda: True)

    def grab(*_a, **_k):
        calls["grab"] += 1
        return "frame.png"

    def apply(params, **_k):
        calls["apply"] += 1
        return params

    monkeypatch.setattr(protect_mod, "grab_mid_frame", grab)
    monkeypatch.setattr(protect_mod, "apply_to_params", apply)
    monkeypatch.setattr(upscale_mod, "available", lambda: True)

    def fake_upscale(src, params, path, platform=None):
        open(path, "w").close()
        return path, "cmd", []

    monkeypatch.setattr(upscale_mod, "upscale_clip", fake_upscale)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32),
    )

    pipeline.run(_cfg(
        tmp_path, quality_mode="hq", auto_tune=False, uniq_strengths=[1.0],
    ))
    assert calls["grab"] == 1
    assert calls["apply"] >= 1


def test_pipeline_resolves_landscape_tiktok_to_1920x1080(monkeypatch, tmp_path):
    """16:9 ingest must render 1920×1080, not stretch to 1080×1920."""
    _stub_common(monkeypatch)

    class LandscapeSrc:
        path = "src.mp4"
        sha256 = "deadbeef"
        duration_s = 1.0
        width = 3840
        height = 2160

        def to_dict(self):
            return {"path": self.path, "width": self.width, "height": self.height}

    monkeypatch.setattr(pipeline, "probe", lambda p: LandscapeSrc())
    captured = {}

    def fake_render(src, params, platform, path, dry_run=False):
        captured["size"] = (platform.width, platform.height)
        captured["name"] = platform.name
        open(path, "w").close()
        return (path, "ffmpeg -y fake")

    monkeypatch.setattr(pipeline, "render_variant", fake_render)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )
    manifest = pipeline.run(_cfg(tmp_path, platform="tiktok"))
    assert captured["size"] == (1920, 1080)
    assert captured["name"] == "tiktok"
    assert manifest.run["canvas"] == [1920, 1080]


def test_pipeline_passes_shot_into_sample(monkeypatch, tmp_path):
    _stub_common(monkeypatch)
    seen = []

    def fake_sample(preset, seed, **kw):
        seen.append(kw.get("shot"))
        return {"video": {"rotate_deg": 0.0}, "audio": {}}

    monkeypatch.setattr(pipeline, "sample", fake_sample)
    monkeypatch.setattr(
        pipeline, "classify_shot",
        lambda *a, **k: {"kind": "talking_head", "self_bits": 10},
    )
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )
    manifest = pipeline.run(_cfg(tmp_path, auto_tune=False, uniq_strengths=[1.0]))
    assert seen
    assert all(s == "talking_head" for s in seen)
    assert manifest.run["shot"]["kind"] == "talking_head"
    assert manifest.run["shot"]["self_bits"] == 10


def test_talking_head_peer_miss_does_not_escalate(monkeypatch, tmp_path):
    """Still-face copies land ~13 peer bits; strong crop 0.78 is face-zoom and still fails."""
    _stub_common(monkeypatch)
    presets = []

    def fake_sample(preset, seed, **kw):
        presets.append(preset.name)
        return {"video": {"rotate_deg": 0.0}, "audio": {}}

    monkeypatch.setattr(pipeline, "sample", fake_sample)
    monkeypatch.setattr(
        pipeline, "classify_shot",
        lambda *a, **k: {"kind": "talking_head", "self_bits": 17},
    )
    bits_calls = {"n": 0}

    def fake_bits_vs(a, b):
        bits_calls["n"] += 1
        return 13

    monkeypatch.setattr(pipeline.uniqueness, "bits_vs", fake_bits_vs)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.625, bits=40, status="ok"),
    )
    cfg = _cfg(tmp_path, count=2, auto_tune=True, allow_creative_escalate=True)
    manifest = pipeline.run(cfg)
    v1, v2 = manifest.variants
    assert v1.preset_used == "medium"
    assert v2.preset_used == "medium"
    assert v1.escalated is False
    assert v2.escalated is False
    assert v1.uniqueness_status == "ok"
    assert v2.uniqueness_status == "ok"
    assert v2.quality.get("min_bits_vs_peers") is None
    assert bits_calls["n"] == 0
    assert "strong" not in presets


class _Src720(FakeSrc):
    width = 720
    height = 1280


def test_fast_keeps_720p_inside_tiktok_canvas(monkeypatch, tmp_path):
    """Naive 720→1080 is glitter until Real-ESRGAN exists. Fast stays native."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(pipeline, "probe", lambda p: _Src720())
    seen = []

    def fake_render(src, params, platform, path, dry_run=False):
        seen.append(platform)
        open(path, "w").close()
        return (path, "ffmpeg -y fake")

    monkeypatch.setattr(pipeline, "render_variant", fake_render)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )
    pipeline.run(_cfg(tmp_path, platform="tiktok", auto_tune=False, uniq_strengths=[1.0]))
    assert seen
    assert all(p.width == 720 and p.height == 1280 for p in seen)


def test_hq_still_targets_1080_from_720p(monkeypatch, tmp_path):
    """HQ Real-ESRGAN is the true upscaler — keep the 1080×1920 social canvas."""
    _stub_common(monkeypatch)
    monkeypatch.setattr(pipeline, "probe", lambda p: _Src720())
    seen = []

    def fake_upscale(src, params, path, platform=None):
        seen.append(platform)
        open(path, "w").close()
        return path, "cmd", []

    import variant_maker.neural.upscale as upscale_mod

    monkeypatch.setattr(upscale_mod, "available", lambda: True)
    monkeypatch.setattr(upscale_mod, "upscale_clip", fake_upscale)
    monkeypatch.setattr(
        pipeline.uniqueness, "score_uniqueness",
        lambda src_path, variant_path, target=None: _ok_score(0.5, bits=32, status="ok"),
    )
    pipeline.run(_cfg(
        tmp_path, platform="tiktok", quality_mode="hq",
        auto_tune=False, uniq_strengths=[1.0],
    ))
    assert seen
    assert all(p is not None and p.width == 1080 and p.height == 1920 for p in seen)


def test_pipeline_forwards_copyid_gate(monkeypatch, tmp_path):
    _stub_common(monkeypatch)
    seen = {}

    def fake_score(src_path, variant_path, target=None, **kw):
        seen["kw"] = kw
        return _ok_score(0.5, bits=32, status="ok")

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)
    manifest = pipeline.run(_cfg(tmp_path, copyid="gate", uniq_strengths=[1.0]))
    assert seen["kw"].get("copyid") == "gate"
    assert manifest.run.get("copyid") == "gate"


def test_pipeline_records_heads_on_quality(monkeypatch, tmp_path):
    _stub_common(monkeypatch)
    heads = {
        "ssim": {"uniqueness": 0.5, "bits": 32, "available": True},
        "visual": {"uniqueness": 0.2, "sim": 0.6, "available": True},
    }

    def fake_score(src_path, variant_path, target=None, **kw):
        return {**_ok_score(0.5, bits=32, status="ok"), "heads": heads}

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)
    manifest = pipeline.run(_cfg(tmp_path, copyid="record", uniq_strengths=[1.0]))
    assert manifest.variants[0].quality.get("heads")["visual"]["sim"] == 0.6
    assert manifest.run.get("copyid") == "record"

def test_pipeline_records_heads_through_fast_autotune(monkeypatch, tmp_path):
    """Fast daily packs reconstruct ``u`` from tune() — must keep copyid heads.

    Lab pack 3d4fae98ca77 ran copyid=record but wrote quality.heads=null
    because the auto_tune success path copied bits/status and dropped heads.
    """
    _stub_common(monkeypatch)
    heads = {
        "ssim": {"uniqueness": 0.5, "bits": 32, "available": True, "status": "ok"},
        "audio": {"uniqueness": 0.26, "sim": 0.74, "available": True, "status": "ok"},
        "visual": {"uniqueness": None, "sim": None, "available": False},
    }

    def fake_score(src_path, variant_path, target=None, **kw):
        return {
            **_ok_score(0.5, bits=32, status="ok"),
            "heads": heads,
            "copyid_mode": kw.get("copyid") or "record",
        }

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_score)
    manifest = pipeline.run(_cfg(
        tmp_path, copyid="record", auto_tune=True, allow_creative_escalate=False,
    ))
    got = manifest.variants[0].quality.get("heads")
    assert got is not None
    assert got["audio"]["sim"] == 0.74
    assert got["visual"]["available"] is False
    assert manifest.run.get("copyid") == "record"


def test_pipeline_record_scores_heads_after_uniqueness(monkeypatch, tmp_path):
    """record must not fpcalc on the uniqueness thread. SSIM wait, then heads.

    Lab pack ce6862e51d4c paid ~20s of Chromaprint inside uniqueness. Source
    fingerprint also ran again on copy 2. Heads still land on quality.heads.
    """
    _stub_common(monkeypatch)
    order: list[str] = []
    uniq_kw: list[dict] = []

    def fake_uniq(src_path, variant_path, target=None, **kw):
        order.append("uniq")
        uniq_kw.append(kw)
        return _ok_score(0.5, bits=32, status="ok")

    def fake_mae(src_path, variant_path, video=None):
        order.append("mae")
        return {
            "look_status": "ok", "look_metric": "coarse_luma_v1",
            "look_mae": 8.0, "look_mae_max": 10.0, "look_target": 38.0,
        }

    def fake_attach(result, src_path, variant_path, **kw):
        order.append("audio")
        return {
            **result,
            "heads": {
                "ssim": {"uniqueness": 0.5, "bits": 32, "available": True},
                "audio": {
                    "uniqueness": 0.18, "sim": 0.82, "available": True,
                    "status": "ok", "via": "ffmpeg_s16le",
                },
            },
            "copyid_mode": "record",
        }

    monkeypatch.setattr(pipeline.uniqueness, "score_uniqueness", fake_uniq)
    monkeypatch.setattr(pipeline.look, "score_look", fake_mae)
    monkeypatch.setattr(pipeline.uniqueness, "attach_copyid_heads", fake_attach)

    manifest = pipeline.run(_cfg(
        tmp_path, copyid="record", uniq_strengths=[1.0],
        allow_creative_escalate=False,
    ))
    assert uniq_kw[0].get("copyid") == "record"
    assert uniq_kw[0].get("attach_heads") is False
    assert order == ["uniq", "mae", "audio"]
    audio = manifest.variants[0].quality.get("heads")["audio"]
    assert audio["sim"] == 0.82
    assert audio["via"] == "ffmpeg_s16le"

