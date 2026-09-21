"""Untitled copies get a regular unique name — never camera UUID _v15/_v16 stems."""
from __future__ import annotations

from variant_maker.variant_names import clip_filename, regularize_variant_filename

UUID = "A56531F9-75C2-48A0-B7F2-47A84244E81D"


def test_clip_filename_is_regular_unique_mp4():
    assert clip_filename(0xC0FFEE01) == "clip_c0ffee01.mp4"
    assert clip_filename(0x1FFFFFFFF) == "clip_ffffffff.mp4"


def test_engine_uuid_siblings_become_distinct_clip_names():
    a = f"{UUID}_v15_c0ffee01.mp4"
    b = f"{UUID}_v16_c0ffee02.mp4"
    assert regularize_variant_filename(a) == "clip_c0ffee01.mp4"
    assert regularize_variant_filename(b) == "clip_c0ffee02.mp4"
    assert regularize_variant_filename(a) != regularize_variant_filename(b)


def test_camera_uuid_alone_is_not_shipped():
    name = f"{UUID}.mp4"
    out = regularize_variant_filename(name)
    assert out.startswith("clip_")
    assert out.endswith(".mp4")
    assert UUID not in out
    assert "_v1" not in out


def test_already_regular_names_stay_put():
    assert regularize_variant_filename("v01.mp4") == "v01.mp4"
    assert regularize_variant_filename("clip_abcd1234.mp4") == "clip_abcd1234.mp4"
    assert regularize_variant_filename("Wait for it #reels.mp4") == "Wait for it #reels.mp4"
