"""Pure copy-detection compare math. No ffmpeg, no torch, no numpy."""
from __future__ import annotations

import math
from collections.abc import Sequence

Vec = Sequence[float]
Seq = Sequence[Sequence[float]]


def _dot(a: Vec, b: Vec) -> float:
    n = min(len(a), len(b))
    return sum(float(a[i]) * float(b[i]) for i in range(n))


def _norm(a: Vec) -> float:
    return math.sqrt(sum(float(x) * float(x) for x in a))


def cosine(a: Vec, b: Vec) -> float:
    """Cosine similarity in [-1, 1]. Identical direction → 1. Empty → 0."""
    if not a or not b:
        return 0.0
    na, nb = _norm(a), _norm(b)
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    val = _dot(a, b) / (na * nb)
    return max(-1.0, min(1.0, val))


def mean_pool(seq: Seq) -> list[float]:
    if not seq:
        raise ValueError("mean_pool of empty sequence")
    dim = len(seq[0])
    out = [0.0] * dim
    n = 0
    for row in seq:
        n += 1
        for i in range(min(dim, len(row))):
            out[i] += float(row[i])
    return [x / n for x in out]


def chamfer_sim(query: Seq, ref: Seq) -> float:
    """Asymmetric Chamfer: mean over query of max cosine vs any ref vector.

    Robust to micro-trim / mild speed (each query frame can match a nearby
    ref frame). Empty → 0.
    """
    if not query or not ref:
        return 0.0
    acc = 0.0
    for q in query:
        acc += max(cosine(q, r) for r in ref)
    return acc / len(query)


def aligned_mean_sim(a: Seq, b: Seq) -> float:
    """Diagnostic: mean cosine of same-index pairs (min length)."""
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    return sum(cosine(a[i], b[i]) for i in range(n)) / n


def uniq_from_sim(sim: float, tau: float) -> float:
    """Map similarity to uniqueness in [0, 1]. sim >= tau → 0 (copy-like)."""
    t = float(tau)
    if t <= 0.0:
        return 0.0
    return max(0.0, min(1.0, (t - float(sim)) / t))
