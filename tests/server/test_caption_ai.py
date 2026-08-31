import json

from variant_maker.server.caption_ai import (
    ANTHROPIC_URL,
    DEFAULT_ANTHROPIC_CAPTION_MODEL,
    anthropic_caption_model,
    captions_for_source,
    local_caption,
    source_stem,
)


def test_local_caption_is_unique_per_index():
    a = local_caption("if you didnt know a good boil #viral.mp4", 1, 3)
    b = local_caption("if you didnt know a good boil #viral.mp4", 2, 3)
    assert a != b
    assert "Copy 1 of 3" in a
    assert "Copy 2 of 3" in b
    assert "#viral" in a
    assert "/" not in a and "\\" not in a


def test_captions_for_source_needs_operator_prompt(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("VARIANT_OPENAI_API_KEY", raising=False)
    assert captions_for_source("boil.mp4", 2, environ={}) == []
    out = captions_for_source("boil.mp4", 2, prompt="POV boil #reels", environ={})
    assert len(out) == 2
    assert "POV boil #reels" in out[0]
    assert "Copy 1 of 2" in out[0]
    assert "Copy 2 of 2" in out[1]


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

