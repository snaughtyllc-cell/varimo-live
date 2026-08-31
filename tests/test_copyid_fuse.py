from variant_maker.copyid.fuse import FUSED_METRIC, fuse_heads


def test_fuse_min_of_present():
    r = fuse_heads(
        {
            "ssim": {"uniqueness": 0.50, "available": True},
            "visual": {"uniqueness": 0.20, "available": True},
            "audio": {"uniqueness": 0.80, "available": True},
        },
        target=0.375,
    )
    assert r["uniqueness"] == 0.20
    assert r["uniqueness_status"] == "below_target"
    assert r["uniqueness_metric"] == FUSED_METRIC
    assert set(r["fused_from"]) == {"ssim", "visual", "audio"}


def test_fuse_ignores_unavailable_and_none():
    r = fuse_heads(
        {
            "ssim": {"uniqueness": 0.50, "available": True},
            "visual": {"uniqueness": None, "available": False},
            "audio": None,
        },
        target=0.375,
    )
    assert r["uniqueness"] == 0.50
    assert r["uniqueness_status"] == "ok"
    assert r["fused_from"] == ["ssim"]


def test_fuse_all_missing_unknown():
    r = fuse_heads({"visual": {"available": False, "uniqueness": None}}, target=0.375)
    assert r["uniqueness"] is None
    assert r["uniqueness_status"] == "unknown"
    assert r["fused_from"] == []


def test_fuse_ok_when_min_clears_target():
    r = fuse_heads(
        {"ssim": {"uniqueness": 0.5}, "audio": {"uniqueness": 0.4}},
        target=0.375,
    )
    assert r["uniqueness_status"] == "ok"
