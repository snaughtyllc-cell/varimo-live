import json
import re

from variant_maker.server.caption_ai import (
    ANTHROPIC_URL,
    DEFAULT_ANTHROPIC_CAPTION_MODEL,
    _prompt,
    anthropic_caption_model,
    brief_from_filename,
    briefs_for_sources,
    captions_for_source,
    hook_key,
    local_caption,
    parse_caption_prompts_field,
    source_stem,
    split_ai_captions,
    strip_internal_index_lines,
    too_similar,
)


def test_local_caption_is_unique_per_index():
    a = local_caption("if you didnt know a good boil #viral.mp4", 1, 3)
    b = local_caption("if you didnt know a good boil #viral.mp4", 2, 3)
    assert a != b
    assert "copy 1 of" not in a.lower()
    assert "copy 2 of" not in b.lower()
    assert "#viral" in a
    assert "/" not in a and "\\" not in a


def test_captions_for_source_needs_operator_prompt(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("VARIANT_OPENAI_API_KEY", raising=False)
    assert captions_for_source("boil.mp4", 2, environ={}) == []
    out = captions_for_source("boil.mp4", 2, prompt="POV boil #reels", environ={})
    assert len(out) == 2
    assert "POV boil" in out[0]
    assert out[0] != out[1]
    joined = "\n".join(out).lower()
    assert "copy 1 of" not in joined
    assert "copy 2 of" not in joined
    assert "take 1 of" not in joined


def test_source_stem_strips_extension():
    assert source_stem("folder/clip.mp4") == "clip"


def test_anthropic_caption_model_defaults_to_haiku_4_5():
    assert DEFAULT_ANTHROPIC_CAPTION_MODEL == "claude-haiku-4-5"
    assert anthropic_caption_model({}) == "claude-haiku-4-5"
    assert anthropic_caption_model({"VARIANT_CAPTION_MODEL": ""}) == "claude-haiku-4-5"


def test_anthropic_caption_model_upgrades_retired_3_5():
    assert anthropic_caption_model({"VARIANT_CAPTION_MODEL": "claude-3-5-haiku-latest"}) == "claude-haiku-4-5"
    assert anthropic_caption_model({"VARIANT_CAPTION_MODEL": "claude-3-5-haiku-20241022"}) == "claude-haiku-4-5"
    assert anthropic_caption_model({"VARIANT_CAPTION_MODEL": "gpt-4o-mini"}) == "claude-haiku-4-5"


def test_anthropic_caption_model_keeps_current_4_5():
    assert anthropic_caption_model({"VARIANT_CAPTION_MODEL": "claude-haiku-4-5"}) == "claude-haiku-4-5"
    assert (
        anthropic_caption_model({"VARIANT_CAPTION_MODEL": "claude-haiku-4-5-20251001"})
        == "claude-haiku-4-5-20251001"
    )


def test_captions_prefer_anthropic_haiku_4_5_over_openai(monkeypatch):
    calls = []

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"content": [{"text": "POV boil\n#reels\n---\nWait for it\n#fyp"}]}).encode()

    def fake_urlopen(req, timeout=None):
        calls.append((req.full_url, json.loads(req.data.decode())))
        return FakeResp()

    monkeypatch.setattr("variant_maker.server.caption_ai.urllib.request.urlopen", fake_urlopen)
    out = captions_for_source(
        "boil.mp4",
        2,
        prompt="POV she said wait for it #reels",
        environ={
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "OPENAI_API_KEY": "sk-openai-test",
            "VARIANT_CAPTION_MODEL": "claude-3-5-haiku-latest",
        },
    )
    assert len(calls) == 1
    assert calls[0][0] == ANTHROPIC_URL
    assert calls[0][1]["model"] == "claude-haiku-4-5"
    assert "POV she said wait for it" in calls[0][1]["messages"][0]["content"]
    assert "POV boil" in out[0]
    assert "Wait for it" in out[1]


def test_captions_for_source_falls_back_when_anthropic_body_is_empty(monkeypatch):
    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"content": []}).encode()

    monkeypatch.setattr(
        "variant_maker.server.caption_ai.urllib.request.urlopen",
        lambda req, timeout=None: FakeResp(),
    )
    out = captions_for_source(
        "boil.mp4",
        2,
        prompt="POV boil #reels",
        environ={"ANTHROPIC_API_KEY": "sk-ant-test"},
    )
    assert len(out) == 2
    assert "boil" in out[0].lower()


def test_split_numbered_list_without_dashes_is_one_caption_each():
    raw = (
        "1. POV the boil hits different\n#reels #fyp\n"
        "2. She said wait for the boil\n#reels #fyp\n"
        "3. Real ones know this boil\n#reels #viral"
    )
    out = split_ai_captions(raw, 3, "POV boil #reels")
    assert len(out) == 3
    assert "hits different" in out[0]
    assert "wait for the boil" in out[1]
    assert "Real ones" in out[2]
    assert len(set(out)) == 3
    assert "Copy 2 of 3" not in out[1]


def test_split_json_array_captions():
    raw = json.dumps([
        "POV the boil hits different\n#reels",
        "She said wait for it\n#fyp",
        "Real ones know\n#viral",
    ])
    out = split_ai_captions(raw, 3, "POV boil #reels")
    assert out[0].startswith("POV the boil")
    assert "wait for it" in out[1]
    assert "Real ones" in out[2]


def test_duplicate_ai_captions_are_uniquified():
    raw = "Same hook #reels\n---\nSame hook #reels\n---\nSame hook #reels"
    out = split_ai_captions(raw, 3, "Same hook #reels")
    assert len(out) == 3
    assert len({re.sub(r"\s+", " ", c.strip().lower()) for c in out}) == 3
    joined = "\n".join(out).lower()
    assert "copy " not in joined or "copy 1 of" not in joined
    assert "take 1 of" not in joined
    assert "take 2 of" not in joined


def test_prompt_demands_distinct_rewrites_not_copy_paste():
    text = _prompt("boil.mp4", 8, "POV boil #reels")
    lower = text.lower()
    assert "distinct" in lower or "unique" in lower
    assert "json" in lower
    assert "pov boil #reels" in lower
    assert "copy 1 of 20" in lower


def test_strip_internal_index_lines_drops_copy_n_of_m():
    raw = "POV the boil hits different\n\nCopy 1 of 20\n#reels"
    assert strip_internal_index_lines(raw) == "POV the boil hits different\n\n#reels"


def test_parse_caption_prompts_json_array():
    assert parse_caption_prompts_field('["a","b"]') == ["a", "b"]
    assert parse_caption_prompts_field("") == []
    assert parse_caption_prompts_field("just one") == ["just one"]


def test_briefs_for_sources_are_per_source():
    assert briefs_for_sources(2, caption_prompts=["POV boil", "Gym pull"]) == ["POV boil", "Gym pull"]
    assert briefs_for_sources(2, caption_prompt="shared") == ["shared", "shared"]
    assert briefs_for_sources(2, caption_prompt="shared", caption_prompts=["only first", ""]) == [
        "only first",
        "",
    ]


def test_brief_from_filename_keeps_hook_and_hashtags():
    seed = brief_from_filename("POV she said wait for it #reels #fyp.mp4")
    assert "wait for it" in seed.lower()
    assert "#reels" in seed
    assert ".mp4" not in seed


def test_hook_key_treats_opener_prefix_as_the_same_copy():
    a = "POV the boil hits different\n#reels"
    b = "Wait — POV the boil hits different\n#reels"
    assert hook_key(a) == hook_key(b)


def test_too_similar_when_the_same_hook_repeats():
    same = ["POV the boil hits different\n#reels"] * 8
    assert too_similar(same, 8) is True
    mixed = [
        "POV the boil hits different\n#reels",
        "She said wait for the drop\n#reels",
        "Real ones know this clip\n#reels",
        "If you blinked you missed it\n#reels",
    ]
    assert too_similar(mixed, 4) is False


def test_split_drops_repeated_hooks_instead_of_keeping_copies():
    raw = json.dumps(["POV the boil hits different\n#reels"] * 4)
    out = split_ai_captions(raw, 4, "POV the boil hits different #reels")
    assert len(out) == 4
    keys = {hook_key(item) for item in out}
    assert len(keys) >= 3


def test_anthropic_retries_when_hooks_repeat(monkeypatch):
    calls = []

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            if len(calls) == 1:
                return json.dumps({"content": [{"text": json.dumps(["same hook #reels"] * 3)}]}).encode()
            return json.dumps({
                "content": [{
                    "text": json.dumps([
                        "POV the boil hits different\n#reels",
                        "She said wait for the drop\n#reels",
                        "Real ones know this clip\n#reels",
                    ]),
                }],
            }).encode()

    def fake_urlopen(req, timeout=None):
        calls.append((req.full_url, json.loads(req.data.decode())))
        return FakeResp()

    monkeypatch.setattr("variant_maker.server.caption_ai.urllib.request.urlopen", fake_urlopen)
    out = captions_for_source(
        "boil.mp4",
        3,
        prompt="POV boil #reels",
        environ={"ANTHROPIC_API_KEY": "sk-ant-test"},
    )
    assert len(calls) == 2
    assert "previous batch" in calls[1][1]["messages"][0]["content"].lower()
    assert len({hook_key(item) for item in out}) >= 3

