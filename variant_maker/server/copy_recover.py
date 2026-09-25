"""Match GPU object-store names to Studio job.json filenames.

After untitled copies became clip_{seed}.mp4, leftover Fast workers still
upload {stem}_v01_{seed}.mp4. Gallery can record one name while R2 has the
other. Recover any variant mp4 under outputs/{source_id}/ — not only v01.mp4.
"""
from __future__ import annotations

import os
import re

from variant_maker.variant_names import ENGINE_NAME_RE

CLIP_NAME_RE = re.compile(r"^clip_([0-9a-fA-F]{8})\.mp4$")
_SKIP_STEMS = frozenset({"manifest"})


def _base(name: str) -> str:
    return os.path.basename(name or "")


def is_variant_mp4(name: str) -> bool:
    base = _base(name)
    stem, ext = os.path.splitext(base)
    if ext.lower() != ".mp4" or not stem or stem.lower() in _SKIP_STEMS:
        return False
    if stem.startswith("look_"):
        return False
    return not stem.endswith("_variants")


def variant_mp4_basenames(keys: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for key in keys:
        base = _base(key)
        if not is_variant_mp4(base) or base in seen:
            continue
        seen.add(base)
        out.append(base)
    return out


def seed_hex_from_filename(name: str) -> str | None:
    base = _base(name)
    match = ENGINE_NAME_RE.match(base)
    if match:
        return match.group("seed").lower()
    match = CLIP_NAME_RE.match(base)
    if match:
        return match.group(1).lower()
    return None


def index_from_variant_filename(name: str) -> int | None:
    base = _base(name)
    match = ENGINE_NAME_RE.match(base)
    if match:
        return int(match.group("index"))
    stem, ext = os.path.splitext(base)
    if ext.lower() == ".mp4" and stem.startswith("v") and stem[1:].isdigit():
        return int(stem[1:])
    return None


def match_outputs(
    recorded: list[tuple[int, str]],
    available: list[str],
) -> dict[int, str]:
    """Map variant index -> an available basename (exact, then seed, then index)."""
    avail = variant_mp4_basenames(available)
    claimed: set[str] = set()
    result: dict[int, str] = {}

    for index, filename in recorded:
        base = _base(filename)
        if base in avail and base not in claimed:
            result[index] = base
            claimed.add(base)

    for index, filename in recorded:
        if index in result:
            continue
        seed = seed_hex_from_filename(filename)
        if not seed:
            continue
        for cand in avail:
            if cand in claimed:
                continue
            if seed_hex_from_filename(cand) == seed:
                result[index] = cand
                claimed.add(cand)
                break

    for index, filename in recorded:
        if index in result:
            continue
        for cand in avail:
            if cand in claimed:
                continue
            if index_from_variant_filename(cand) == index:
                result[index] = cand
                claimed.add(cand)
                break

    leftover = [name for name in avail if name not in claimed]
    leftover.sort()
    pending = [index for index, _ in sorted(recorded, key=lambda item: int(item[0]))
               if index not in result]
    for index, cand in zip(pending, leftover):
        result[index] = cand
    return result


def recover_variants_from_keys(source_id: str, keys: list[str]) -> list[dict]:
    """Build variant metadata from R2 keys when RunPod dropped the result chunk."""
    names = variant_mp4_basenames(keys)
    used: set[int] = set()
    assigned: dict[str, int] = {}
    for name in names:
        idx = index_from_variant_filename(name)
        if idx is None or idx in used:
            continue
        used.add(idx)
        assigned[name] = idx
    next_i = 1
    for name in names:
        if name in assigned:
            continue
        while next_i in used:
            next_i += 1
        assigned[name] = next_i
        used.add(next_i)
        next_i += 1
    found = [
        {
            "index": assigned[name],
            "filename": name,
            "status": "ok",
            "quality": {},
            "key": f"outputs/{source_id}/{name}",
        }
        for name in names
    ]
    found.sort(key=lambda item: int(item["index"]))
    return found
