"""SSCD disc_mixup TorchScript visual backend. Lazy torch import. No PIL."""
from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence

DEFAULT_WEIGHT = os.environ.get(
    "VARIANT_MAKER_SSCD_PATH",
    os.path.join("models", "sscd", "sscd_disc_mixup.torchscript.pt"),
)
INPUT_SIZE = 288
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class SscdBackend:
    name = "sscd_disc_mixup"

    def __init__(self, weight_path: str | None = None):
        self.weight_path = weight_path or DEFAULT_WEIGHT
        self._model = None

    def available(self) -> bool:
        if not os.path.isfile(self.weight_path):
            return False
        try:
            import torch  # noqa: F401
        except ImportError:
            return False
        return True

    def _load(self):
        if self._model is not None:
            return self._model
        import torch
        model = torch.jit.load(self.weight_path, map_location="cpu")
        model.eval()
        self._model = model
        return model

    def encode(self, frame_paths: Sequence[str]) -> list[list[float]]:
        import torch

        model = self._load()
        tensors = [_png_to_nchw(p, INPUT_SIZE) for p in frame_paths]
        batch = torch.stack(tensors, dim=0)
        with torch.no_grad():
            emb = model(batch)
        if hasattr(emb, "cpu"):
            emb = emb.cpu()
        return [list(map(float, row)) for row in emb.tolist()]


def _png_to_nchw(path: str, size: int):
    """PNG → ImageNet-normalized CHW tensor via ffmpeg (no PIL)."""
    import torch

    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-i", path,
            "-vf", f"scale={size}:{size}",
            "-frames:v", "1",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    raw = proc.stdout
    expected = size * size * 3
    if len(raw) < expected:
        raise ValueError(f"short RGB dump from {path}: {len(raw)} < {expected}")
    t = torch.frombuffer(bytearray(raw[:expected]), dtype=torch.uint8)
    t = t.view(size, size, 3).permute(2, 0, 1).float() / 255.0
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
    return (t - mean) / std
