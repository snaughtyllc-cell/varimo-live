"""score_uniqueness fusion. SSIM path stays default (copyid off)."""
import os
import subprocess
import tempfile

from variant_maker import uniqueness
from variant_maker.copyid import normalize_mode


def _tiny_mp4(path, *, color="black"):
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"color=c={color}:s=64x64:d=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "1", path,
        ],
        check=True,
        capture_output=True,
    )


def test_normalize_mode():
    assert normalize_mode("off") == "off"
    assert normalize_mode("record") == "record"
    assert normalize_mode("gate") == "gate"
    assert normalize_mode(True) == "gate"
    assert normalize_mode(False) == "off"
    assert normalize_mode("AUTO") == "gate"


def test_copyid_off_ignores_extra_heads_for_metric(monkeypatch):
    monkeypatch.delenv("VARIANT_MAKER_COPYID", raising=False)
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a, color="white")
        _tiny_mp4(b, color="black")
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="off",
            extra_heads={"visual": {"uniqueness": 0.0, "available": True, "sim": 1.0}},
        )
        assert r["uniqueness_metric"] == "ssim_bits_v1"
        assert r["uniqueness_status"] == "ok"
        assert "heads" not in r or r["uniqueness"] >= uniqueness.DEFAULT_TARGET


def test_copyid_record_keeps_ssim_gate():
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a, color="white")
        _tiny_mp4(b, color="black")
        visual = {"uniqueness": 0.01, "available": True, "sim": 0.99, "status": "ok"}
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="record",
            extra_heads={"visual": visual},
        )
        assert r["uniqueness_metric"] == "ssim_bits_v1"
        assert r["uniqueness_status"] == "ok"
        assert r["uniqueness"] >= uniqueness.DEFAULT_TARGET
        assert r["heads"]["visual"]["sim"] == 0.99
        assert r["heads"]["ssim"]["bits"] == r["bits"]


def test_copyid_gate_min_with_copy_like_visual():
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a, color="white")
        _tiny_mp4(b, color="black")
        visual = {"uniqueness": 0.05, "available": True, "sim": 0.96, "status": "ok"}
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="gate",
            extra_heads={"visual": visual},
        )
        assert r["uniqueness_metric"] == "fused_v1"
        assert r["uniqueness"] == 0.05
        assert r["uniqueness_status"] == "below_target"
        assert r["bits"] >= uniqueness.TARGET_BITS  # SSIM still saw different colors


def test_copyid_gate_does_not_override_below_floor():
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a)
        _tiny_mp4(b)
        visual = {"uniqueness": 0.9, "available": True, "sim": 0.0, "status": "ok"}
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="gate",
            extra_heads={"visual": visual},
        )
        assert r["uniqueness_status"] == "below_floor"
        assert r["uniqueness_metric"] == "ssim_bits_v1"
        assert r["bits"] < uniqueness.FLOOR_BITS


def test_attach_heads_false_skips_copyid_on_record():
    """record Generate wait is SSIM-only. Heads attach after uniqueness returns."""
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a, color="white")
        _tiny_mp4(b, color="black")
        visual = {"uniqueness": 0.01, "available": True, "sim": 0.99, "status": "ok"}
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="record",
            extra_heads={"visual": visual}, attach_heads=False,
        )
        assert r["uniqueness_metric"] == "ssim_bits_v1"
        assert "heads" not in r
        attached = uniqueness.attach_copyid_heads(
            r, a, b, copyid="record", extra_heads={"visual": visual},
        )
        assert attached["heads"]["visual"]["sim"] == 0.99
        assert attached["uniqueness_metric"] == "ssim_bits_v1"
        assert attached["uniqueness_status"] == "ok"


def test_gate_still_fuses_when_attach_heads_false():
    """gate uniqueness_status needs audio/visual — cannot defer."""
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        _tiny_mp4(a, color="white")
        _tiny_mp4(b, color="black")
        visual = {"uniqueness": 0.05, "available": True, "sim": 0.96, "status": "ok"}
        r = uniqueness.score_uniqueness(
            a, b, target=uniqueness.DEFAULT_TARGET, copyid="gate",
            extra_heads={"visual": visual}, attach_heads=False,
        )
        assert r["uniqueness_metric"] == "fused_v1"
        assert r["uniqueness"] == 0.05
