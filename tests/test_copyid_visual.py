from variant_maker.copyid.backends import FakeBackend, score_visual
from variant_maker.copyid.visual import frame_fracs, score_visual_from_emb


def test_frame_fracs_interior():
    fr = frame_fracs(8)
    assert len(fr) == 8
    assert fr[0] > 0.05 and fr[-1] < 0.95
    assert fr == tuple(sorted(fr))


def test_score_visual_from_emb_identical():
    seq = [[1.0, 0.0], [0.0, 1.0], [0.6, 0.8]]
    r = score_visual_from_emb(seq, seq, tau=0.75, backend="fake")
    assert r["available"] is True
    assert r["sim"] > 0.99
    assert r["uniqueness"] == 0.0


def test_score_visual_from_emb_different():
    q = [[1.0, 0.0], [1.0, 0.0]]
    ref = [[0.0, 1.0], [0.0, 1.0]]
    r = score_visual_from_emb(q, ref, tau=0.75)
    assert r["uniqueness"] > 0.9
    assert r["sim"] < 0.1


def test_fake_backend_score_visual_no_ffmpeg():
    seq = [[1.0, 0.0], [0.2, 0.9]]
    backend = FakeBackend(sequence=seq)
    r = score_visual(
        "src.mp4", "var.mp4", backend,
        extract_fn=lambda path, n=8, **k: [f"{path}-{i}" for i in range(2)],
    )
    assert r["available"] is True
    assert r["backend"] == "fake"
    assert r["uniqueness"] == 0.0


def test_unavailable_backend():
    backend = FakeBackend(available_flag=False)
    r = score_visual("a", "b", backend, extract_fn=lambda *a, **k: [])
    assert r["available"] is False
    assert r["uniqueness"] is None


def test_sscd_import_does_not_load_torch():
    """Tier-1: importing the SSCD module must not require torch at import time."""
    import variant_maker.copyid.sscd as sscd_mod
    # If a previous test already imported torch, this still asserts the module
    # body did not bind it as a top-level name.
    assert "torch" not in sscd_mod.__dict__
