"""Visual embedding backends. Torch is imported only inside SSCD/DINO modules."""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from collections.abc import Sequence

from .visual import DEFAULT_N_FRAMES, DEFAULT_TAU, score_visual_from_emb

VecSeq = Sequence[Sequence[float]]


class VisualBackend(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool:
        ...

    @abstractmethod
    def encode(self, frame_paths: Sequence[str]) -> list[list[float]]:
        """One L2-friendly vector per frame image path."""


class FakeBackend(VisualBackend):
    """Test double. ``encode_fn(paths) -> embeddings`` or a fixed sequence."""

    name = "fake"

    def __init__(
        self,
        sequence: VecSeq | None = None,
        encode_fn=None,
        *,
        available_flag: bool = True,
    ):
        self._sequence = [list(map(float, row)) for row in sequence] if sequence else None
        self._encode_fn = encode_fn
        self._available_flag = available_flag

    def available(self) -> bool:
        return bool(self._available_flag)

    def encode(self, frame_paths: Sequence[str]) -> list[list[float]]:
        if self._encode_fn is not None:
            return self._encode_fn(frame_paths)
        if self._sequence is not None:
            return [list(row) for row in self._sequence]
        # Deterministic toy embedding from path index so identical extracts match.
        out: list[list[float]] = []
        for i, _p in enumerate(frame_paths):
            out.append([1.0, float(i), 0.0])
        return out


def get_visual_backend(kind: str | None = None) -> VisualBackend | None:
    """Resolve SSCD → DINO → None. ``kind``: auto|sscd|dino|off|fake."""
    raw = (kind or os.environ.get("VARIANT_MAKER_COPYID_VISUAL") or "auto").strip().lower()
    if raw in ("off", "none", "0"):
        return None
    if raw == "fake":
        return FakeBackend()
    if raw in ("sscd", "auto"):
        from .sscd import SscdBackend
        b = SscdBackend()
        if b.available():
            return b
        if raw == "sscd":
            return None
    if raw in ("dino", "auto"):
        from .dino import DinoBackend
        b = DinoBackend()
        if b.available():
            return b
        if raw == "dino":
            return None
    return None


def score_visual(
    src_path: str,
    variant_path: str,
    backend: VisualBackend,
    *,
    n_frames: int = DEFAULT_N_FRAMES,
    tau: float = DEFAULT_TAU,
    extract_fn=None,
) -> dict:
    """Extract frames, embed, Chamfer. Backend/extract failures → unavailable."""
    unavailable = {
        "uniqueness": None,
        "sim": None,
        "status": "unknown",
        "available": False,
        "backend": getattr(backend, "name", "unknown"),
        "n_frames": n_frames,
    }
    if not backend.available():
        return unavailable
    grab = extract_fn
    if grab is None:
        from .frames import extract_rgb_pngs
        grab = extract_rgb_pngs
    try:
        src_frames = grab(src_path, n=n_frames)
        var_frames = grab(variant_path, n=n_frames)
        q = backend.encode(src_frames)
        r = backend.encode(var_frames)
        return score_visual_from_emb(
            q, r, tau=tau, backend=backend.name, n_frames=n_frames,
        )
    except (OSError, ValueError, TypeError, RuntimeError):
        return unavailable
