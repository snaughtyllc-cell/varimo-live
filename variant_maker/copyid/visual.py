"""Visual-temporal uniqueness from frame embeddings (Chamfer cosine)."""
from __future__ import annotations

from collections.abc import Sequence

from .compare import aligned_mean_sim, chamfer_sim, uniq_from_sim

# SSCD disc_mixup ~90% precision around cosine 0.75 (starting calibration).
DEFAULT_TAU = 0.75
DEFAULT_N_FRAMES = 8


def score_visual_from_emb(
    query: Sequence[Sequence[float]],
    ref: Sequence[Sequence[float]],
    *,
    tau: float = DEFAULT_TAU,
    backend: str = "fake",
    n_frames: int | None = None,
) -> dict:
    """Pure: two embedding sequences → visual head dict."""
    if not query or not ref:
        return {
            "uniqueness": None,
            "sim": None,
            "status": "unknown",
            "available": False,
            "backend": backend,
            "n_frames": 0,
        }
    sim = chamfer_sim(query, ref)
    aligned = aligned_mean_sim(query, ref)
    uniq = uniq_from_sim(sim, tau)
    return {
        "uniqueness": uniq,
        "sim": sim,
        "sim_aligned": aligned,
        "status": "ok",
        "available": True,
        "backend": backend,
        "n_frames": n_frames if n_frames is not None else len(query),
        "tau": tau,
    }


def frame_fracs(n: int = DEFAULT_N_FRAMES) -> tuple[float, ...]:
    """Interior sample points 1/(n+1) … n/(n+1). Avoids exact 0/1 seeks."""
    n = max(1, int(n))
    return tuple((i + 1) / (n + 1) for i in range(n))
