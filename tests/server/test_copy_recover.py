from variant_maker.server.copy_recover import (
    index_from_variant_filename,
    match_outputs,
    recover_variants_from_keys,
    seed_hex_from_filename,
    variant_mp4_basenames,
)


def test_seed_and_index_from_clip_and_engine_names():
    assert seed_hex_from_filename("clip_c0ffee01.mp4") == "c0ffee01"
    assert seed_hex_from_filename("Virgin-copy (7)_v01_c0ffee01.mp4") == "c0ffee01"
    assert index_from_variant_filename("v03.mp4") == 3
    assert index_from_variant_filename("Virgin-copy (7)_v01_c0ffee01.mp4") == 1
    assert index_from_variant_filename("clip_c0ffee01.mp4") is None


def test_variant_mp4_basenames_skip_stills_and_manifest():
    keys = [
        "outputs/s1/clip_c0ffee01.mp4",
        "outputs/s1/manifest.json",
        "outputs/s1/look_v01.jpg",
        "outputs/s1/Virgin-copy (7)_v02_abcd1234.mp4",
        "outputs/s1/s1_variants.zip",
    ]
    assert variant_mp4_basenames(keys) == [
        "clip_c0ffee01.mp4",
        "Virgin-copy (7)_v02_abcd1234.mp4",
    ]


def test_match_outputs_pairs_clip_record_to_engine_object():
    recorded = [(1, "clip_c0ffee01.mp4")]
    available = ["Virgin-copy (7)_v01_c0ffee01.mp4"]
    assert match_outputs(recorded, available) == {
        1: "Virgin-copy (7)_v01_c0ffee01.mp4",
    }


def test_match_outputs_keeps_exact_name_first():
    recorded = [(1, "clip_c0ffee01.mp4")]
    available = ["clip_c0ffee01.mp4", "Virgin-copy (7)_v01_c0ffee01.mp4"]
    assert match_outputs(recorded, available) == {1: "clip_c0ffee01.mp4"}


def test_recover_variants_from_clip_keys():
    found = recover_variants_from_keys("s1", [
        "outputs/s1/clip_c0ffee01.mp4",
        "outputs/s1/clip_c0ffee02.mp4",
        "outputs/s1/manifest.json",
    ])
    assert [v["filename"] for v in found] == [
        "clip_c0ffee01.mp4",
        "clip_c0ffee02.mp4",
    ]
    assert [v["index"] for v in found] == [1, 2]
