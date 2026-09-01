"""Per-variant captions for Studio Generate.

Tries Anthropic (Haiku 4.5), then OpenAI, then a local prompt-based
fallback so Studio works before an API key is configured.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Mapping

from .captions import split_caption_bank, strip_internal_index_lines

STEM_RE = re.compile(r"\.[^.]+$")
HASHTAG_RE = re.compile(r"#\w+")
JSON_ARRAY_RE = re.compile(r"\[.*\]", re.DOTALL)
NUMBERED_RE = re.compile(r"(?m)^\s*\d+[.)]\s+")
DASH_SPLIT_RE = re.compile(r"(?m)^\s*---\s*$")
OPENERS = (
    "",
    "Wait — ",
    "Real talk: ",
    "If you needed a sign: ",
    "This is the one: ",
    "Nobody talks about this: ",
    "Keep this: ",
    "The version that hits: ",
)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_ANTHROPIC_CAPTION_MODEL = "claude-haiku-4-5"
DEFAULT_OPENAI_CAPTION_MODEL = "gpt-4o-mini"
CAPTION_TIMEOUT_SEC = 45


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
    extras = tags[:6] if tags else ["#fyp", "#viral"]
    rotated = extras[(index - 1) % len(extras):] + extras[: (index - 1) % len(extras)]
    opener = OPENERS[(index - 1) % len(OPENERS)]
    return strip_internal_index_lines(f"{opener}{hook}\n\n{' '.join(rotated)}")


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


def captions_for_source(
    filename: str,
    count: int,
    *,
    prompt: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> list[str]:
    n = max(0, int(count))
    brief = (prompt or "").strip()
    if n == 0 or not brief:
        return []
    env = os.environ if environ is None else environ
    anthropic_key = (env.get("ANTHROPIC_API_KEY") or env.get("VARIANT_ANTHROPIC_API_KEY") or "").strip()
    if anthropic_key:
        try:
            return _anthropic_captions(filename, n, anthropic_key, env, brief)
        except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            pass
    openai_key = (env.get("OPENAI_API_KEY") or env.get("VARIANT_OPENAI_API_KEY") or "").strip()
    if openai_key:
        try:
            return _openai_captions(filename, n, openai_key, env, brief)
        except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
            pass
    return _fill_unique([], brief, n)


def parse_caption_prompts_field(raw: str | None) -> list[str]:
    """Form `caption_prompts` is a JSON array; a bare string is one prompt."""
    text = (raw or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [text]
    if isinstance(data, list):
        return ["" if item is None else str(item) for item in data]
    if isinstance(data, str):
        return [data]
    return []


def briefs_for_sources(
    count: int,
    *,
    caption_prompt: str = "",
    caption_prompts: list[str] | None = None,
) -> list[str]:
    """One seed caption per source. Per-source list wins; shared prompt fills every slot."""
    n = max(0, int(count))
    per = [str(p) for p in (caption_prompts or [])]
    if per:
        return [(per[i].strip() if i < len(per) else "") for i in range(n)]
    shared = (caption_prompt or "").strip()
    return [shared] * n if shared else [""] * n


def local_caption_from_prompt(brief: str, index: int, total: int) -> str:
    return publishable_unique_caption(brief, index, total, set())


def _split_hook_tags(text: str) -> tuple[str, list[str]]:
    tags = HASHTAG_RE.findall(text or "")
    hook = HASHTAG_RE.sub("", text or "")
    hook = re.sub(r"[ \t]+", " ", hook)
    hook = re.sub(r"\n{3,}", "\n\n", hook).strip() or "New clip"
    return hook, tags


def publishable_unique_caption(
    brief: str,
    index: int,
    total: int,
    seen: set[str],
) -> str:
    """A Drive-safe rewrite of `brief` with no internal Copy/Take index lines."""
    text = strip_internal_index_lines(brief) or "New clip"
    hook, tags = _split_hook_tags(text)
    tag_src = tags or ["#fyp", "#viral"]
    n_open = len(OPENERS)
    n_tag = len(tag_src)
    for shift in range(max(int(total), n_open, n_tag) + 2):
        opener = OPENERS[(index - 1 + shift) % n_open]
        rot = (index - 1 + shift) % n_tag
        rotated = tag_src[rot:] + tag_src[:rot]
        cand = strip_internal_index_lines(f"{opener}{hook}\n\n{' '.join(rotated)}")
        key = _norm_caption(cand)
        if key and key not in seen:
            return cand
    return text


def _prompt(filename: str, count: int, brief: str) -> str:
    return (
        "Write Instagram Reels / TikTok captions for short UGC clips.\n"
        f"Source filename: {source_stem(filename)}\n"
        "The operator wrote this seed caption:\n"
        f"{brief.strip()}\n\n"
        f"Write exactly {count} DISTINCT captions, one unique rewrite per variant.\n"
        "Each caption must use different hook wording — not a copy-paste of the seed, "
        "not the same sentence with a number tacked on.\n"
        "Keep the same meaning, topic, and hashtag set (order may change).\n"
        "Do not output the seed caption verbatim more than once.\n"
        "Never write lines like Copy 1 of 20 or Take 2 of 8 — those are internal and must not appear.\n"
        "Each caption: 1-2 short hook lines, then 3-8 hashtags. No / or \\ characters.\n"
        f"Output ONLY a JSON array of {count} strings, like "
        "[\"hook\\n\\n#tags\",\"other hook\\n\\n#tags\"].\n"
        "No markdown fences. No intro."
    )


def _norm_caption(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _strip_fences(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[^\n]*\n", "", text)
        text = re.sub(r"\n```\s*$", "", text)
    return text.strip()


def _json_captions(text: str) -> list[str]:
    candidates = [text]
    match = JSON_ARRAY_RE.search(text)
    if match:
        candidates.append(match.group(0))
    for blob in candidates:
        try:
            data = json.loads(blob)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            data = data.get("captions") or data.get("items") or []
        if not isinstance(data, list):
            continue
        out: list[str] = []
        for item in data:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                cap = item.get("caption") or item.get("text")
                if isinstance(cap, str) and cap.strip():
                    out.append(cap.strip())
        if out:
            return out
    return []


def _numbered_captions(text: str) -> list[str]:
    if not NUMBERED_RE.search(text):
        return []
    parts = [p.strip() for p in NUMBERED_RE.split(text) if p.strip()]
    if parts and len(parts[0].splitlines()) == 1 and not HASHTAG_RE.search(parts[0]) and len(parts) > 1:
        parts = parts[1:]
    return parts if len(parts) >= 2 else []


def _bank_captions(text: str) -> list[str]:
    return [p for p in split_caption_bank(text or "") if p]


def extract_caption_parts(raw: str) -> list[str]:
    """Turn model output into caption blocks (JSON, ---, numbered list, or blanks)."""
    text = _strip_fences(raw)
    if not text:
        return []
    json_parts = _json_captions(text)
    if json_parts:
        return json_parts
    if DASH_SPLIT_RE.search(text):
        return _bank_captions(text)
    numbered = _numbered_captions(text)
    if numbered:
        return numbered
    return _bank_captions(text)


def _fill_unique(parts: list[str], brief: str, count: int) -> list[str]:
    n = max(0, int(count))
    seen: set[str] = set()
    unused = [strip_internal_index_lines(p) for p in parts if strip_internal_index_lines(p)]
    out: list[str] = []
    for slot in range(n):
        cand = unused[slot] if slot < len(unused) else ""
        cand = strip_internal_index_lines(cand)
        if not cand or _norm_caption(cand) in seen:
            cand = publishable_unique_caption(brief, slot + 1, n, seen)
        cand = strip_internal_index_lines(cand)
        key = _norm_caption(cand)
        if key in seen:
            cand = publishable_unique_caption(brief, slot + 1, n, seen)
            key = _norm_caption(cand)
        if key:
            seen.add(key)
        out.append(cand)
    return out


def _ensure_unique(parts: list[str], brief: str, count: int) -> list[str]:
    return _fill_unique(parts, brief, count)


def split_ai_captions(raw: str, count: int, brief: str) -> list[str]:
    """Parse model output into `count` distinct captions for one source."""
    return _ensure_unique(extract_caption_parts(raw), brief, count)


def _split_ai(raw: str, count: int, brief: str) -> list[str]:
    return split_ai_captions(raw, count, brief)


def _caption_max_tokens(count: int) -> int:
    return min(8192, max(2048, int(count) * 400))


def _openai_captions(filename: str, count: int, key: str, env: Mapping[str, str], brief: str) -> list[str]:
    raw = (env.get("VARIANT_CAPTION_MODEL") or "").strip()
    model = raw if raw.lower().startswith("gpt-") else DEFAULT_OPENAI_CAPTION_MODEL
    payload = json.dumps({
        "model": model or DEFAULT_OPENAI_CAPTION_MODEL,
        "messages": [
            {"role": "system", "content": "You write short social captions. Each copy must be a unique rewrite."},
            {"role": "user", "content": _prompt(filename, count, brief)},
        ],
        "temperature": 0.9,
    }).encode()
    req = urllib.request.Request(
        OPENAI_URL,
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=CAPTION_TIMEOUT_SEC) as resp:
        body = json.loads(resp.read().decode())
    text = body["choices"][0]["message"]["content"]
    return split_ai_captions(text, count, brief)


def _anthropic_captions(filename: str, count: int, key: str, env: Mapping[str, str], brief: str) -> list[str]:
    model = anthropic_caption_model(env)
    payload = json.dumps({
        "model": model,
        "max_tokens": _caption_max_tokens(count),
        "temperature": 0.9,
        "messages": [{"role": "user", "content": _prompt(filename, count, brief)}],
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
    with urllib.request.urlopen(req, timeout=CAPTION_TIMEOUT_SEC) as resp:
        body = json.loads(resp.read().decode())
    text = body["content"][0]["text"]
    return split_ai_captions(text, count, brief)
