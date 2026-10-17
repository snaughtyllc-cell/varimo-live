"""On-screen timing stays on the caption. A blank window is the whole clip."""

from variant_maker.onscreen import fonts_ready, normalize_project, overlay_enable

_PROJECT = {
    "captions": [{
        "id": "1",
        "text": "Sale",
        "box_ids": ["A"],
        "show": "",
        "hide": "",
    }],
    "boxes": [{"id": "A", "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.2}],
    "look": {"style": "classic", "background": "solid", "color": "#FFFFFF"},
}


def test_blank_timing_window_stays_on_the_whole_clip():
    assert overlay_enable("", "") is None
    assert overlay_enable(None, None) is None
    clean = normalize_project(_PROJECT)
    assert clean is not None
    assert "show" not in clean["captions"][0]
    assert "hide" not in clean["captions"][0]


def test_show_and_hide_are_seconds_on_the_caption():
    raw = {
        **_PROJECT,
        "captions": [{**_PROJECT["captions"][0], "show": 1.5, "hide": 4}],
    }
    clean = normalize_project(raw)
    assert clean is not None
    assert clean["captions"][0]["show"] == 1.5
    assert clean["captions"][0]["hide"] == 4.0
    assert overlay_enable(1.5, 4) == "between(t,1.5,4)"


def test_onscreen_fonts_are_packaged():
    assert fonts_ready()
