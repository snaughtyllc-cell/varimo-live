"""Conservative fusion: uniqueness is the *min* of available heads."""
from __future__ import annotations

FUSED_METRIC = "fused_v1"


def fuse_heads(
    heads: dict[str, dict | None],
    *,
    target: float | None = None,
) -> dict:
    """Combine per-head scores.

    Heads with ``available=False`` or ``uniqueness is None`` are omitted.
    All omitted → unknown. Never invents a high score.
    """
    present: list[tuple[str, float]] = []
    for name, head in heads.items():
        if not head:
            continue
        if head.get("available") is False:
            continue
        uniq = head.get("uniqueness")
        if uniq is None:
            continue
        present.append((name, float(uniq)))

    if not present:
        return {
            "uniqueness": None,
            "uniqueness_status": "unknown",
            "uniqueness_metric": FUSED_METRIC,
            "uniqueness_target": target,
            "fused_from": [],
        }

    fused = min(u for _, u in present)
    names = [n for n, _ in present]
    if target is None or fused >= float(target):
        status = "ok"
    else:
        status = "below_target"
    return {
        "uniqueness": fused,
        "uniqueness_status": status,
        "uniqueness_metric": FUSED_METRIC,
        "uniqueness_target": target,
        "fused_from": names,
    }
