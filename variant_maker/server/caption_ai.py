"""Per-variant captions for Studio Generate.

Tries Anthropic (Haiku 4.5), then OpenAI, then a local filename-based
fallback so Studio works before an API key is configured.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Mapping

STEM_RE = re.compile(r"\.[^.]+$")
HASHTAG_RE = re.compile(r"#\w+")

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_ANTHROPIC_CAPTION_MODEL = "claude-haiku-4-5"
DEFAULT_OPENAI_CAPTION_MODEL = "gpt-4o-mini"


def source_stem(filename: str) -> str:
    name = os.path.basename(filename or "clip").strip() or "clip"
    return STEM_RE.sub("", name).strip() or "clip"


def local_caption(filename: str, index: int, total: int) -> str:
    """Deterministic caption when no AI key is set. Safe for Drive filenames."""
    stem = source_stem(filename)
    tags = HASHTAG_RE.findall(stem)
    hook = HASHTAG_RE.sub("", stem)
    hook = re.sub(r"[_-]+", " ", hook)
    hook = re.sub(r"\s+", " ", hook).strip(" .") or "New clip"
    if len(hook) > 80:
        hook = hook[:80].rstrip()
    extras = " ".join(tags[:6]) if tags else "#fyp #viral"
    return f"{hook}\n\nCopy {index} of {total} — unique take\n{extras}"


def _retired_haiku(model: str) -> bool:
    name = (model or "").strip().lower()
    return "3-5-haiku" in name or "3.5-haiku" in name or "claude-3-haiku" in name


def anthropic_caption_model(environ: Mapping[str, str] | None = None) -> str:
    """Haiku 4.5 unless Railway already points at a current Claude id.

    Retired 3.5 Haiku ids (and OpenAI ids leftover in VARIANT_CAPTION_MODEL)
    are remapped so a stale env var cannot keep calling a discontinued model.
    """
    env = os.environ if environ is None else environ
    raw = (env.get("VARIANT_CAPTION_MODEL") or "").strip()
    if not raw or _retired_haiku(raw) or raw.lower().startswith("gpt-"):
        return DEFAULT_ANTHROPIC_CAPTION_MODEL
    return raw


def captions_for_source(filename: str, count: int, *, environ: Mapping[str, str] | None = None) -> list[str]:
    n = max(0, int(count))
    if n == 0:
        return []
    env = os.environ if environ is None else environ
    anthropic_key = (env.get("ANTHROPIC_API_KEY") or env.get("VARIANT_ANTHROPIC_API_KEY") or "").strip()
    if anthropic_key:
        try:
            return _anthropic_captions(filename, n, anthropic_key, env)
        except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            pass
    openai_key = (env.get("OPENAI_API_KEY") or env.get("VARIANT_OPENAI_API_KEY") or "").strip()
    if openai_key:
        try:
            return _openai_captions(filename, n, openai_key, env)
        except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            pass
    return [local_caption(filename, i + 1, n) for i in range(n)]


def _prompt(filename: str, count: int) -> str:
    return (
        "Write Instagram Reels / TikTok captions for short UGC clips.\n"
        f"Source filename: {source_stem(filename)}\n"
        f"Write exactly {count} captions, one per variant.\n"
        "Output ONLY the captions. No intro. Separate them with a line that is exactly ---\n"
        "Each caption: 1-2 short hook lines, then 3-8 hashtags. No / or \\ characters."
    )


def _split_ai(raw: str, count: int, filename: str) -> list[str]:
    from variant_maker.server.captions import split_caption_bank

    parts = split_caption_bank(raw or "")
    out = [p for p in parts if p][:count]
    while len(out) < count:
        out.append(local_caption(filename, len(out) + 1, count))
    return out[:count]


def _openai_captions(filename: str, count: int, key: str, env: Mapping[str, str]) -> list[str]:
    raw = (env.get("VARIANT_CAPTION_MODEL") or "").strip()
    model = raw if raw.lower().startswith("gpt-") else DEFAULT_OPENAI_CAPTION_MODEL
    payload = json.dumps({
        "model": model or DEFAULT_OPENAI_CAPTION_MODEL,
        "messages": [
            {"role": "system", "content": "You write short social captions."},
            {"role": "user", "content": _prompt(filename, count)},
        ],
        "temperature": 0.7,
    }).encode()
    req = urllib.request.Request(
        OPENAI_URL,
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode())
    text = body["choices"][0]["message"]["content"]
    return _split_ai(text, count, filename)


def _anthropic_captions(filename: str, count: int, key: str, env: Mapping[str, str]) -> list[str]:
    model = anthropic_caption_model(env)
    payload = json.dumps({
        "model": model,
        "max_tokens": 2000,
        "messages": [{"role": "user", "content": _prompt(filename, count)}],
    }).encode()
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=payload,
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode())
    text = body["content"][0]["text"]
    return _split_ai(text, count, filename)
