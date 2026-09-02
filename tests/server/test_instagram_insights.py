"""Match Reels to Gallery copies; pack totals skip unlinked (unknown ≠ 0)."""
from __future__ import annotations

from datetime import UTC, datetime

from tests.server.fakes import FakeRunner
from variant_maker.server.instagram_insights import (
    IgMedia,
    VariantLink,
    caption_from_drive_filename,
    export_caption_hints,
    gallery_analytics,
    list_media,
    match_media,
    normalize_caption,
    pack_analytics,
    pack_suggestions,
    parse_insights_payload,
    permalink_key,
    unmatched_media,
)
from variant_maker.server.jobs import JobStore
from variant_maker.server.workspace import Workspace


def test_permalink_key_strips_query_and_host():
    assert permalink_key("https://www.instagram.com/reel/AbC123/?igsh=xyz") == "abc123"
    assert permalink_key("instagram.com/p/AbC123/") == "abc123"


def test_caption_from_drive_filename_skips_generic_variant_names():
    assert caption_from_drive_filename("Unique Lab Hook.mp4") == "Unique Lab Hook"
    assert caption_from_drive_filename("v01.mp4") is None
    assert caption_from_drive_filename("v12.mp4") is None


def test_export_caption_hints_prefer_newest_non_generic_name():
    class File:
        def __init__(self, source_id, index, filename):
            self.source_id = source_id
            self.index = index
            self.filename = filename

    class Exp:
        def __init__(self, files):
            self.files = files

    hints = export_caption_hints([
        Exp([File("s1", 1, "Newer hook.mp4")]),
        Exp([File("s1", 1, "Older hook.mp4")]),
        Exp([File("s1", 2, "v02.mp4")]),
    ])
    assert hints[("s1", 1)] == "Newer hook"
    assert ("s1", 2) not in hints


def test_normalize_caption_flattens_drive_newlines():
    assert normalize_caption("POV: boil\n\n#reels") == "pov: boil #reels"


def test_match_prefers_permalink_then_unique_caption():
    variants = [
        VariantLink("s1", 1, post_url="https://instagram.com/reel/Aaa/", caption="hook one #x"),
        VariantLink("s1", 2, post_url=None, caption="hook two #y"),
        VariantLink("s1", 3, post_url=None, caption="hook two #y"),
    ]
    media = [
        IgMedia("m1", permalink="https://www.instagram.com/reel/Aaa/", caption="ignored"),
        IgMedia("m2", permalink="https://www.instagram.com/reel/Bbb/", caption="hook two #y"),
        IgMedia("m3", permalink="https://www.instagram.com/reel/Ccc/", caption="hook two #y"),
    ]
    matches = {(m.index, m.via, m.media_id) for m in match_media(variants, media)}
    assert (1, "permalink", "m1") in matches
    # Duplicate caption on two copies AND two Reels — do not guess.
    assert not any(idx in (2, 3) for idx, _via, _mid in matches)


def test_unique_caption_links_when_exactly_one_each():
    variants = [
        VariantLink("s1", 7, post_url=None, caption="  Unique Hook  "),
    ]
    media = [
        IgMedia("media7", permalink="https://instagram.com/reel/Zzz/", caption="unique hook"),
    ]
    hits = match_media(variants, media)
    assert len(hits) == 1
    assert hits[0].via == "caption"
    assert hits[0].media_id == "media7"


def test_list_media_uses_me_when_populated():
    urls: list[str] = []

    def get_json(url: str):
        urls.append(url)
        return {"data": [{"id": "m1", "permalink": "https://instagram.com/reel/Aaa/"}]}

    rows = list_media("17841", "tok", get_json=get_json)
    assert rows[0]["id"] == "m1"
    assert len(urls) == 1
    assert "/me/media" in urls[0]
    assert "access_token=tok" in urls[0]


def test_list_media_falls_back_to_ig_id_when_me_is_empty():
    def get_json(url: str):
        if "/me/media" in url:
            return {"data": []}
        return {"data": [{"id": "m2"}]}

    rows = list_media("17841", "tok", get_json=get_json)
    assert rows[0]["id"] == "m2"


def test_list_media_raises_when_both_paths_error():
    def get_json(url: str):
        raise ValueError("Instagram HTTP 400: Invalid user id")

    try:
        list_media("17841", "tok", get_json=get_json)
    except ValueError as exc:
        assert "Invalid user id" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_pack_analytics_unknown_is_not_zero():
    class V:
        def __init__(self, media=None, views=None):
            self.ig_media_id = media
            self.ig_insights = {"views": views} if views is not None else None

    empty = pack_analytics([V(), V()])
    assert empty["insights_views"] is None
    assert empty["insights_linked"] == 0
    assert empty["insights_unknown"] == 2

    mixed = pack_analytics([V("m1", 100), V()])
    assert mixed["insights_views"] == 100
    assert mixed["insights_linked"] == 1
    assert mixed["insights_unknown"] == 1


def test_gallery_analytics_ranks_the_winning_source():
    class V:
        def __init__(self, media, views):
            self.ig_media_id = media
            self.ig_insights = {"views": views}

    class S:
        def __init__(self, source_id, filename, variants):
            self.source_id = source_id
            self.filename = filename
            self.variants = variants

    body = gallery_analytics([
        S("quiet", "quiet.mp4", [V("a", 10)]),
        S("winner", "winner.mp4", [V("b", 900), V("c", 100)]),
    ])
    assert body["insights_views"] == 1010
    assert body["ranked"][0]["source_id"] == "winner"
    assert body["ranked"][0]["insights_views"] == 1000


def test_parse_insights_reads_total_value_and_values():
    body = {
        "data": [
            {"name": "views", "total_value": {"value": 312400}},
            {"name": "likes", "values": [{"value": 12}]},
        ]
    }
    assert parse_insights_payload(body) == {"views": 312400, "likes": 12}


def test_set_ig_insights_survives_hydrate(tmp_path):
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    idx = src.variants[0].index
    updated = store.set_ig_insights(
        src.source_id, idx,
        ig_media_id="m9",
        ig_user_id="17841",
        insights={"views": 44, "likes": 2, "fetched_at": "2026-09-02T00:00:00Z"},
        post_url="https://www.instagram.com/reel/HydrateIg/",
    )
    assert updated is not None
    assert updated.ig_media_id == "m9"
    assert updated.ig_insights["views"] == 44

    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job.job_id).sources[0].variants[0]
    assert restored.ig_media_id == "m9"
    assert restored.ig_user_id == "17841"
    assert restored.ig_insights["views"] == 44
    assert restored.post_url == "https://www.instagram.com/reel/HydrateIg/"


def test_unmatched_media_are_not_guessed():
    variants = [
        VariantLink("s1", 1, post_url="https://instagram.com/reel/Aaa/", caption="hook"),
    ]
    media = [
        IgMedia("m1", permalink="https://www.instagram.com/reel/Aaa/", caption="hook"),
        IgMedia("m2", permalink="https://www.instagram.com/reel/Orphan/", caption="other line"),
    ]
    hits = match_media(variants, media)
    leftover = unmatched_media(media, hits)
    assert [m.id for m in leftover] == ["m2"]


def test_pack_suggestions_winner_needs_floor_and_gap():
    now = datetime(2026, 9, 2, tzinfo=UTC)
    packs = [
        {
            "source_id": "winner",
            "filename": "winner.mp4",
            "insights_views": 80_000,
            "insights_linked": 8,
            "created_utc": "2026-08-30T00:00:00Z",
        },
        {
            "source_id": "ok",
            "filename": "ok.mp4",
            "insights_views": 12_000,
            "insights_linked": 6,
            "created_utc": "2026-08-30T00:00:00Z",
        },
        {
            "source_id": "quiet",
            "filename": "quiet.mp4",
            "insights_views": 40,
            "insights_linked": 5,
            "created_utc": "2026-08-30T00:00:00Z",
        },
    ]
    out = pack_suggestions(packs, now=now)
    kinds = {row["kind"]: row for row in out}
    assert kinds["winner"]["source_id"] == "winner"
    assert "Generate 20 more" in kinds["winner"]["copy"]
    assert kinds["quiet"]["source_id"] == "quiet"
    assert "flagged" not in kinds["quiet"]["copy"].lower()
    assert "not getting push" in kinds["quiet"]["copy"]


def test_pack_suggestions_skips_fresh_quiet_and_weak_leaders():
    now = datetime(2026, 9, 2, 12, tzinfo=UTC)
    packs = [
        {
            "source_id": "fresh",
            "filename": "fresh.mp4",
            "insights_views": 10,
            "insights_linked": 5,
            "created_utc": "2026-09-02T01:00:00Z",
        },
        {
            "source_id": "slight",
            "filename": "slight.mp4",
            "insights_views": 400,
            "insights_linked": 2,
            "created_utc": "2026-08-20T00:00:00Z",
        },
    ]
    assert pack_suggestions(packs, now=now) == []
