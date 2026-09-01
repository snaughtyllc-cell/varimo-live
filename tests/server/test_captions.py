from variant_maker.server.captions import (
    CaptionError,
    CaptionStore,
    caption_filename,
    sanitize_caption_stem,
    split_caption_bank,
)


def test_split_caption_bank_on_dash_lines():
    raw = "POV: busy night\n\n#reels\n---\nSecond caption\n#fyp\n---\n\n"
    assert split_caption_bank(raw) == [
        "POV: busy night\n\n#reels",
        "Second caption\n#fyp",
    ]


def test_split_caption_bank_blank_lines_and_numbers():
    raw = "1. POV: she looked back\n#reels\n\n2. Wait for it\n#fyp"
    assert split_caption_bank(raw) == [
        "POV: she looked back\n#reels",
        "Wait for it\n#fyp",
    ]


def test_split_caption_bank_strips_code_fence():
    raw = "```\nFirst #reels\n---\nSecond #fyp\n```"
    assert split_caption_bank(raw) == ["First #reels", "Second #fyp"]


def test_sanitize_keeps_hashtags_and_emoji():
    assert sanitize_caption_stem("Wait for it 💕\n#reels #fyp") == "Wait for it 💕 #reels #fyp"


def test_sanitize_strips_drive_illegal_chars():
    assert "/" not in sanitize_caption_stem("a/b")
    assert "\\" not in sanitize_caption_stem("a\\b")
    assert ":" in sanitize_caption_stem("POV: wait")


def test_caption_filename_strips_copy_n_of_m():
    name = caption_filename("POV boil\n\nCopy 1 of 20\n#reels", "v01.mp4")
    assert name == "POV boil #reels.mp4"
    assert "copy" not in name.lower() or "copy 1 of" not in name.lower()
    take = caption_filename("Gym pull\nTake 2 of 8\n#fyp", "v02.mp4")
    assert take == "Gym pull #fyp.mp4"
    assert caption_filename("Hello world", "v01.mp4") == "Hello world.mp4"
    assert caption_filename("   ", "v01.mp4") == "v01.mp4"
    assert caption_filename(None, "v01.mp4") == "v01.mp4"


def test_store_peek_does_not_advance_take_does(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    store.add("one")
    store.add("two")
    store.add("three")
    assert store.peek(2) == ["one", "two"]
    assert store.peek(2) == ["one", "two"]
    assert store.take(2) == ["one", "two"]
    assert store.peek(2) == ["three", "one"]


def test_store_wraps_when_bank_is_smaller_than_pack(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    store.add("a")
    store.add("b")
    assert store.take(3) == ["a", "b", "a"]


def test_empty_bank_peek_and_take_are_empty(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    assert store.peek(5) == []
    assert store.take(5) == []


def test_legacy_file_migrates_into_generic_folder(tmp_path):
    path = tmp_path / "captions.json"
    path.write_text(
        '{"cursor": 1, "items": [{"id": "cap_old", "text": "Jump #reels"}]}',
        encoding="utf-8",
    )
    store = CaptionStore(str(path))
    banks = store.list_banks()
    assert len(banks) == 1
    assert banks[0].name == "Generic"
    assert banks[0].is_default is True
    assert [c.text for c in store.list()] == ["Jump #reels"]
    assert store.cursor() == 0  # 1 item, cursor 1 % 1 == 0


def test_folders_keep_separate_captions(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    store.add("generic hook")
    gym = store.create_bank("Gym")
    store.add("gym pump #gymtok", bank_id=gym.id)
    assert [c.text for c in store.list()] == ["generic hook"]
    assert [c.text for c in store.list(gym.id)] == ["gym pump #gymtok"]
    assert store.take(1) == ["generic hook"]
    assert store.take(1, bank_id=gym.id) == ["gym pump #gymtok"]


def test_cannot_delete_generic_folder(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    generic = store.list_banks()[0]
    try:
        store.delete_bank(generic.id)
        raise AssertionError("expected CaptionError")
    except CaptionError as exc:
        assert "generic" in str(exc).lower() or "default" in str(exc).lower()


def test_folder_remaining_counts_down_until_wrap(tmp_path):
    store = CaptionStore(str(tmp_path / "captions.json"))
    gym = store.create_bank("Gym")
    store.add("a", bank_id=gym.id)
    store.add("b", bank_id=gym.id)
    store.add("c", bank_id=gym.id)
    meta = store.bank_meta(gym.id)
    assert meta.count == 3
    assert meta.remaining == 3
    store.take(2, bank_id=gym.id)
    meta = store.bank_meta(gym.id)
    assert meta.remaining == 1
    assert meta.low is True
