"""ffmpeg RGB frame grabs for visual backends. Lazy; tests can inject."""
from __future__ import annotations

import os
import subprocess
import tempfile

from .visual import DEFAULT_N_FRAMES, frame_fracs


def _probe_duration(path: str) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    raw = (out.stdout or "").strip()
    if not raw or raw.upper() == "N/A":
        raise ValueError(f"no valid duration in ffprobe output: {raw!r}")
    return max(float(raw), 0.1)


def extract_rgb_pngs(
    path: str,
    *,
    n: int = DEFAULT_N_FRAMES,
    size: int = 288,
    out_dir: str | None = None,
) -> list[str]:
    """Extract N PNG frames, short-side scaled then center-cropped to ``size``.

    Returns file paths. Caller owns ``out_dir`` (temp if omitted — then files
    live until that temp dir is cleaned by the caller).
    """
    dur = _probe_duration(path)
    own = out_dir is None
    tmp = out_dir or tempfile.mkdtemp(prefix="vm-copyid-")
    os.makedirs(tmp, exist_ok=True)
    vf = (
        f"scale={size}:{size}:force_original_aspect_ratio=increase,"
        f"crop={size}:{size}"
    )
    paths: list[str] = []
    try:
        for i, frac in enumerate(frame_fracs(n)):
            dest = os.path.join(tmp, f"f_{i:02d}.png")
            t = frac * dur
            subprocess.run(
                [
                    "ffmpeg", "-v", "error",
                    "-i", path,
                    "-ss", f"{max(0.0, t):.6f}",
                    "-vf", vf,
                    "-frames:v", "1",
                    "-y", dest,
                ],
                check=True,
                capture_output=True,
            )
            if not os.path.isfile(dest) or os.path.getsize(dest) <= 0:
                raise ValueError(f"empty frame extract at t={t}")
            paths.append(dest)
        return paths
    except Exception:
        if own:
            for p in paths:
                if os.path.isfile(p):
                    os.remove(p)
        raise
