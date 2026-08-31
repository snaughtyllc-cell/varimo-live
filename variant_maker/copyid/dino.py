"""DINOv2-small visual fallback. Lazy transformers import."""
from __future__ import annotations

import os
from collections.abc import Sequence

DINO_REPO = os.environ.get("VARIANT_MAKER_DINO_REPO", "facebook/dinov2-small")


class DinoBackend:
    name = "dinov2_small"

    def __init__(self, repo: str | None = None):
        self.repo = repo or DINO_REPO
        self._model = None
        self._processor = None

    def available(self) -> bool:
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401
        except ImportError:
            return False
        return True

    def _load(self):
        if self._model is not None:
            return
        from transformers import AutoImageProcessor, AutoModel
        self._processor = AutoImageProcessor.from_pretrained(self.repo)
        self._model = AutoModel.from_pretrained(self.repo)
        self._model.eval()

    def encode(self, frame_paths: Sequence[str]) -> list[list[float]]:
        import torch
        from PIL import Image

        self._load()
        images = [Image.open(p).convert("RGB") for p in frame_paths]
        inputs = self._processor(images=images, return_tensors="pt")
        with torch.no_grad():
            out = self._model(**inputs)
            cls = out.last_hidden_state[:, 0, :]
            cls = torch.nn.functional.normalize(cls, dim=-1)
        return [list(map(float, row)) for row in cls.cpu().tolist()]
