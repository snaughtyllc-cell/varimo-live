"""Regular unique names for untitled copies.

Drive plugins (Repurpose/Buffer) use the filename as the post caption. A real
caption stays the filename. If nobody added one on Drive import or in Studio,
the file is still an ordinary unique clip name — never a camera UUID or a
`{stem}_v15_{seed}.mp4` / `{stem}_v16_{seed}.mp4` sibling pair.
"""
from __future__ import annotations

import os
import re

ENGINE_NAME_RE = re.compile(
    r"^(?P<stem>.+)_v(?P<index>\d{2})_(?P<seed>[0-9a-fA-F]{8})\.mp4$",
)
UUID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}",
)


def clip_filename(seed: int) -> str:
    return f"clip_{seed & 0xFFFFFFFF:08x}.mp4"


def regularize_variant_filename(name: str) -> str:
    """Rewrite engine/UUID stems; leave captions and already-regular names."""
    base = os.path.basename(name or "") or "clip.mp4"
    match = ENGINE_NAME_RE.match(base)
    if match:
        return clip_filename(int(match.group("seed"), 16))
    stem, ext = os.path.splitext(base)
    if ext.lower() == ".mp4" and UUID_RE.match(stem):
        return f"clip_{stem.replace('-', '')[:8].lower()}.mp4"
    return base
