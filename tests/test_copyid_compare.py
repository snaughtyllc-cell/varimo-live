"""Pure copy-detection compare math — no ffmpeg."""
from variant_maker.copyid.compare import (
    aligned_mean_sim,
    chamfer_sim,
    cosine,
    mean_pool,
    uniq_from_sim,
)


def test_cosine_identical_is_one():
    v = [3.0, 4.0]
    assert cosine(v, v) == 1.0
    assert cosine(v, [6.0, 8.0]) == 1.0  # scale-invariant


def test_cosine_orthogonal_is_zero():
    assert abs(cosine([1.0, 0.0], [0.0, 1.0])) < 1e-9


def test_cosine_empty_is_zero():
    assert cosine([], [1.0]) == 0.0
    assert cosine([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_mean_pool():
    pooled = mean_pool([[1.0, 0.0], [3.0, 2.0]])
    assert pooled == [2.0, 1.0]


def test_mean_pool_empty_raises():
    try:
        mean_pool([])
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_chamfer_identical_sequence():
    seq = [[1.0, 0.0], [0.0, 1.0], [0.6, 0.8]]
    assert chamfer_sim(seq, seq) > 0.999


def test_chamfer_shifted_beats_aligned_mean():
    """Micro-trim: query frames line up with ref at +1 index."""
    ref = [[1.0, 0.0], [0.0, 1.0], [0.6, 0.8]]
    query = [[0.0, 1.0], [0.6, 0.8], [0.6, 0.8]]
    chamfer = chamfer_sim(query, ref)
    aligned = aligned_mean_sim(query, ref)
    assert chamfer > aligned
    assert chamfer > 0.99


def test_chamfer_orthogonal_low():
    q = [[1.0, 0.0], [1.0, 0.0]]
    r = [[0.0, 1.0], [0.0, 1.0]]
    assert chamfer_sim(q, r) < 0.05


def test_uniq_from_sim():
    assert uniq_from_sim(0.75, 0.75) == 0.0
    assert uniq_from_sim(1.0, 0.75) == 0.0
    assert uniq_from_sim(0.0, 0.75) == 1.0
    assert abs(uniq_from_sim(0.375, 0.75) - 0.5) < 1e-9
