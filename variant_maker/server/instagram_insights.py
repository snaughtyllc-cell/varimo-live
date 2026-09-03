"""Match Instagram media to Gallery copies and roll up pack analytics.

Caption match is a unique-on-this-account hint only. Identity is ig_media_id
once linked. Unlinked copies are unknown, not zero views.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from statistics import median
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .instagram_oauth import GRAPH_HOST

_CAPTION_SPACE = re.compile(r"\s+")
_SHORTCODE = re.compile(r"/(?:reel|p|tv)/([A-Za-z0-9_-]+)", re.IGNORECASE)
_VARIANT_FILE = re.compile(r"^v\d+$", re.IGNORECASE)
INSIGHT_METRICS = ("views", "reach", "likes", "comments", "shares", "saved")
INSIGHT_HOLD_METRICS = ("ig_reels_avg_watch_time", "reels_skip_rate")
INSIGHT_CONV_METRICS = ("follows", "profile_visits", "reposts")
WEAK_SKIP = 0.45
WEAK_WATCH_FRAC = 0.30
MIN_DURATION_FOR_WATCH_S = 5.0


def now_utc() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_caption(text: str | None) -> str:
    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", " ")
    return _CAPTION_SPACE.sub(" ", cleaned).strip().lower()


def permalink_key(url: str | None) -> str | None:
    if not url or not str(url).strip():
        return None
    raw = str(url).strip()
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if "instagram.com" not in host:
        path = (parsed.path or "").rstrip("/")
        return path.lower() or None
    match = _SHORTCODE.search(parsed.path or "")
    if match:
        return match.group(1).lower()
    path = (parsed.path or "").rstrip("/").lower()
    return path or None


def caption_from_drive_filename(filename: str | None) -> str | None:
    """Drive export names the file with the caption stem. Skip generic v01.mp4."""
    if not filename or not str(filename).strip():
        return None
    stem = str(filename).replace("\\", "/").rsplit("/", 1)[-1].strip()
    if stem.lower().endswith(".mp4"):
        stem = stem[:-4].rstrip(" .")
    if not stem or _VARIANT_FILE.fullmatch(stem):
        return None
    return stem


def export_caption_hints(exports: Sequence[Any]) -> dict[tuple[str, int], str]:
    """Newest Drive export filename wins when Gallery never stored the bank line."""
    out: dict[tuple[str, int], str] = {}
    for exp in exports:
        files = exp.files if not isinstance(exp, dict) else exp.get("files") or []
        for item in files:
            if isinstance(item, dict):
                source_id = item.get("source_id")
                index = item.get("index")
                name = item.get("filename")
            else:
                source_id = getattr(item, "source_id", None)
                index = getattr(item, "index", None)
                name = getattr(item, "filename", None)
            if not source_id or not isinstance(index, int):
                continue
            key = (str(source_id), int(index))
            if key in out:
                continue
            cap = caption_from_drive_filename(name if isinstance(name, str) else None)
            if cap:
                out[key] = cap
    return out


@dataclass(frozen=True)
class IgMedia:
    id: str
    permalink: str | None = None
    caption: str | None = None
    username: str | None = None
    user_id: str | None = None
    video_duration: float | None = None


def video_duration_s(row: Mapping[str, Any] | None) -> float | None:
    """Graph `video_duration` is seconds. Drop missing / junk values."""
    if not isinstance(row, Mapping):
        return None
    raw = row.get("video_duration")
    if isinstance(raw, str):
        try:
            raw = float(raw.strip())
        except ValueError:
            return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    if value <= 0 or value > 3600:
        return None
    return value


@dataclass(frozen=True)
class VariantLink:
    source_id: str
    index: int
    post_url: str | None
    caption: str | None
    ig_media_id: str | None = None


@dataclass(frozen=True)
class Match:
    source_id: str
    index: int
    media_id: str
    permalink: str | None
    via: str  # media_id | permalink | caption


def match_media(variants: Sequence[VariantLink], media: Sequence[IgMedia]) -> list[Match]:
    """Assign each Reel to at most one copy. Unique caption only if no collision."""
    remaining = {m.id: m for m in media if m.id}
    used_variants: set[tuple[str, int]] = set()
    matches: list[Match] = []

    def take(variant: VariantLink, item: IgMedia, via: str) -> None:
        remaining.pop(item.id, None)
        used_variants.add((variant.source_id, variant.index))
        matches.append(Match(
            source_id=variant.source_id,
            index=variant.index,
            media_id=item.id,
            permalink=item.permalink,
            via=via,
        ))

    for variant in variants:
        key = (variant.source_id, variant.index)
        if key in used_variants:
            continue
        mid = (variant.ig_media_id or "").strip()
        if mid and mid in remaining:
            take(variant, remaining[mid], "media_id")

    by_perm: dict[str, IgMedia] = {}
    for item in remaining.values():
        key = permalink_key(item.permalink)
        if key and key not in by_perm:
            by_perm[key] = item
    for variant in variants:
        vk = (variant.source_id, variant.index)
        if vk in used_variants:
            continue
        key = permalink_key(variant.post_url)
        item = by_perm.get(key or "")
        if item is not None and item.id in remaining:
            take(variant, item, "permalink")

    caption_hits: dict[str, list[IgMedia]] = {}
    for item in remaining.values():
        cap = normalize_caption(item.caption)
        if not cap:
            continue
        caption_hits.setdefault(cap, []).append(item)
    variant_caps: dict[str, list[VariantLink]] = {}
    for variant in variants:
        if (variant.source_id, variant.index) in used_variants:
            continue
        cap = normalize_caption(variant.caption)
        if not cap:
            continue
        variant_caps.setdefault(cap, []).append(variant)
    for cap, items in caption_hits.items():
        copies = variant_caps.get(cap) or []
        if len(items) != 1 or len(copies) != 1:
            continue
        item = items[0]
        if item.id not in remaining:
            continue
        take(copies[0], item, "caption")

    return matches


def parse_insights_payload(body: Mapping[str, Any]) -> dict[str, int | float]:
    out: dict[str, int | float] = {}
    rows = body.get("data")
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        if not isinstance(name, str) or not name:
            continue
        raw: object | None = None
        total = row.get("total_value")
        if isinstance(total, dict):
            raw = total.get("value")
        else:
            values = row.get("values")
            if isinstance(values, list) and values:
                last = values[-1]
                if isinstance(last, dict):
                    raw = last.get("value")
                else:
                    raw = last
        number = _insight_number(raw)
        if number is not None:
            out[name] = number
    return out


def _insight_number(raw: object) -> int | float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        if raw.is_integer() and abs(raw) >= 1:
            return int(raw)
        return raw
    return None


def merge_insight_snapshots(
    existing: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Keep last-known counts when Graph omits a metric on refresh."""
    out: dict[str, Any] = dict(existing) if isinstance(existing, dict) else {}
    if not isinstance(incoming, dict):
        return out
    for key, value in incoming.items():
        if value is not None:
            out[key] = value
    return out


def skip_ratio(snapshot: Mapping[str, Any] | None) -> float | None:
    if not isinstance(snapshot, dict):
        return None
    raw = snapshot.get("reels_skip_rate")
    if not isinstance(raw, (int, float)) or isinstance(raw, bool):
        return None
    value = float(raw)
    if value > 1.5:
        value = value / 100.0
    return min(1.0, max(0.0, value))


def watch_seconds(snapshot: Mapping[str, Any] | None) -> float | None:
    if not isinstance(snapshot, dict):
        return None
    raw = snapshot.get("ig_reels_avg_watch_time")
    if not isinstance(raw, (int, float)) or isinstance(raw, bool):
        return None
    value = float(raw)
    if value < 0:
        return None
    duration = snapshot.get("video_duration")
    duration_s = float(duration) if isinstance(duration, (int, float)) and not isinstance(duration, bool) else None
    if duration_s and value > duration_s * 8:
        return value / 1000.0
    if value > 600:
        return value / 1000.0
    return value


def copy_hold_kind(snapshot: Mapping[str, Any] | None) -> str | None:
    """weak_hold | held | None. Never a policy/flagged stamp."""
    skip = skip_ratio(snapshot)
    watch = watch_seconds(snapshot)
    duration = None
    if isinstance(snapshot, dict):
        raw = snapshot.get("video_duration")
        if isinstance(raw, (int, float)) and not isinstance(raw, bool) and raw > 0:
            duration = float(raw)
    bounce = False
    if skip is not None and skip >= WEAK_SKIP:
        bounce = True
    if (
        watch is not None
        and duration is not None
        and duration >= MIN_DURATION_FOR_WATCH_S
        and watch / duration <= WEAK_WATCH_FRAC
    ):
        bounce = True
    if bounce:
        return "weak_hold"
    if skip is not None or watch is not None:
        return "held"
    return None


def pack_analytics(variants: Iterable[Any]) -> dict[str, Any]:
    """views is None when nothing is linked — never treat unknown as 0."""
    copies = 0
    linked = 0
    totals = {"views": 0, "shares": 0, "saved": 0, "follows": 0, "reach": 0}
    has = {key: False for key in totals}
    hold_votes: list[str] = []
    for variant in variants:
        copies += 1
        snapshot = getattr(variant, "ig_insights", None)
        if isinstance(variant, dict):
            snapshot = variant.get("ig_insights")
            media_id = variant.get("ig_media_id")
        else:
            media_id = getattr(variant, "ig_media_id", None)
        if not media_id:
            continue
        linked += 1
        if isinstance(snapshot, dict):
            for key in totals:
                raw = snapshot.get(key)
                if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                    totals[key] += int(raw)
                    has[key] = True
            kind = copy_hold_kind(snapshot)
            if kind:
                hold_votes.append(kind)
    hold_kind = None
    if hold_votes:
        weak = sum(1 for kind in hold_votes if kind == "weak_hold")
        if weak * 2 >= len(hold_votes):
            hold_kind = "weak_hold"
        elif any(kind == "held" for kind in hold_votes):
            hold_kind = "held"
    return {
        "insights_views": totals["views"] if has["views"] else None,
        "insights_shares": totals["shares"] if has["shares"] else None,
        "insights_saved": totals["saved"] if has["saved"] else None,
        "insights_follows": totals["follows"] if has["follows"] else None,
        "insights_reach": totals["reach"] if has["reach"] else None,
        "insights_linked": linked,
        "insights_unknown": max(0, copies - linked),
        "hold_kind": hold_kind,
    }


def _insight_int(snapshot: Mapping[str, Any], key: str) -> int | None:
    raw = snapshot.get(key)
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return int(raw)
    return None


def tracked_copies(variants: Iterable[Any]) -> list[dict[str, Any]]:
    """Linked copies on a pack, highest views first. Unlinked copies stay off this list."""
    rows: list[dict[str, Any]] = []
    for variant in variants:
        if isinstance(variant, dict):
            index = variant.get("index")
            media_id = variant.get("ig_media_id")
            user_id = variant.get("ig_user_id")
            post_url = variant.get("post_url")
            snapshot = variant.get("ig_insights")
        else:
            index = getattr(variant, "index", None)
            media_id = getattr(variant, "ig_media_id", None)
            user_id = getattr(variant, "ig_user_id", None)
            post_url = getattr(variant, "post_url", None)
            snapshot = getattr(variant, "ig_insights", None)
        if not isinstance(index, int) or not media_id:
            continue
        insights = snapshot if isinstance(snapshot, dict) else {}
        username = insights.get("username") if isinstance(insights.get("username"), str) else None
        rows.append({
            "index": index,
            "ig_media_id": str(media_id),
            "ig_user_id": str(user_id) if isinstance(user_id, str) and user_id else None,
            "username": username or None,
            "post_url": post_url if isinstance(post_url, str) and post_url else None,
            "insights_views": _insight_int(insights, "views"),
            "insights_shares": _insight_int(insights, "shares"),
            "insights_follows": _insight_int(insights, "follows"),
            "hold_kind": copy_hold_kind(insights) if insights else None,
        })
    return sorted(
        rows,
        key=lambda r: (r["insights_views"] is None, -(r["insights_views"] or 0), r["index"]),
    )


def stamp_tracked_accounts(
    rows: Sequence[Mapping[str, Any]],
    *,
    usernames: Mapping[str, str],
    connected_ids: Iterable[str],
) -> None:
    """Mark copies whose Instagram account is still connected. Mutates `tracked`."""
    connected = {str(uid) for uid in connected_ids if uid}
    names = {str(uid): name for uid, name in usernames.items() if uid and name}
    for row in rows:
        if not isinstance(row, dict):
            continue
        tracked = row.get("tracked")
        if not isinstance(tracked, list):
            continue
        for copy in tracked:
            if not isinstance(copy, dict):
                continue
            uid = str(copy.get("ig_user_id") or "")
            if uid and not copy.get("username"):
                name = names.get(uid)
                if name:
                    copy["username"] = name
            copy["account_connected"] = bool(uid and uid in connected)


def gallery_analytics(sources: Sequence[Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    views_sum = 0
    has_views = False
    linked = 0
    for source in sources:
        if isinstance(source, dict):
            source_id = source.get("source_id")
            filename = source.get("filename")
            variants = source.get("variants") or []
        else:
            source_id = getattr(source, "source_id", None)
            filename = getattr(source, "filename", None)
            variants = getattr(source, "variants", None) or []
        pack = pack_analytics(variants)
        linked += int(pack["insights_linked"] or 0)
        if pack["insights_views"] is not None:
            views_sum += int(pack["insights_views"])
            has_views = True
        rows.append({
            "source_id": source_id,
            "filename": filename,
            "insights_views": pack["insights_views"],
            "insights_shares": pack["insights_shares"],
            "insights_follows": pack["insights_follows"],
            "insights_linked": pack["insights_linked"],
            "insights_unknown": pack["insights_unknown"],
            "hold_kind": pack["hold_kind"],
            "tracked": tracked_copies(variants),
        })
    ranked = sorted(
        [r for r in rows if r["insights_linked"]],
        key=lambda r: (r["insights_views"] is None, -(r["insights_views"] or 0)),
    )
    return {
        "insights_views": views_sum if has_views else None,
        "insights_linked": linked,
        "packs": rows,
        "ranked": ranked,
        "suggestions": pack_suggestions(rows),
    }


def lanes_from_sources(sources: Sequence[Any]) -> list[dict[str, Any]]:
    buckets: dict[str, list[Any]] = {}
    for source in sources:
        variants = source.get("variants") if isinstance(source, dict) else getattr(source, "variants", None)
        for variant in variants or []:
            if isinstance(variant, dict):
                user_id = variant.get("ig_user_id")
            else:
                user_id = getattr(variant, "ig_user_id", None)
            if not isinstance(user_id, str) or not user_id:
                continue
            buckets.setdefault(user_id, []).append(variant)
    rows: list[dict[str, Any]] = []
    for user_id, variants in buckets.items():
        pack = pack_analytics(variants)
        if not pack["insights_linked"]:
            continue
        username = None
        for variant in variants:
            snapshot = variant.get("ig_insights") if isinstance(variant, dict) else getattr(variant, "ig_insights", None)
            if isinstance(snapshot, dict) and isinstance(snapshot.get("username"), str) and snapshot["username"]:
                username = snapshot["username"]
                break
        rows.append({
            "ig_user_id": user_id,
            "username": username,
            "insights_views": pack["insights_views"],
            "insights_shares": pack["insights_shares"],
            "insights_follows": pack["insights_follows"],
            "insights_linked": pack["insights_linked"],
            "hold_kind": pack["hold_kind"],
        })
    return sorted(
        rows,
        key=lambda r: (r["insights_views"] is None, -(r["insights_views"] or 0)),
    )


def unmatched_media(media: Sequence[IgMedia], matches: Sequence[Match]) -> list[IgMedia]:
    used = {m.media_id for m in matches}
    return [item for item in media if item.id not in used]


def unmatched_payload(media: Sequence[IgMedia], matches: Sequence[Match]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in unmatched_media(media, matches):
        out.append({
            "media_id": item.id,
            "permalink": item.permalink,
            "caption": item.caption,
            "username": item.username,
            "ig_user_id": item.user_id,
        })
    return out


class InstagramUnmatchedStore:
    """Last Sync leftover Reels. Older posts stay here until someone Links one."""

    def __init__(self, path: str) -> None:
        self._path = path

    def save(self, rows: Sequence[Mapping[str, Any]]) -> None:
        payload = [dict(row) for row in rows if str(row.get("media_id") or "")]
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            dir=os.path.dirname(self._path) or ".", prefix=".ig-unmatched-", suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            os.replace(tmp, self._path)
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    def load(self) -> list[dict[str, Any]]:
        if not os.path.isfile(self._path):
            return []
        try:
            with open(self._path, encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, json.JSONDecodeError, ValueError):
            return []
        if not isinstance(raw, list):
            return []
        out: list[dict[str, Any]] = []
        for row in raw:
            if isinstance(row, dict) and str(row.get("media_id") or ""):
                out.append(row)
        return out

    def remove(self, media_id: str) -> list[dict[str, Any]]:
        want = str(media_id or "")
        rows = [row for row in self.load() if str(row.get("media_id") or "") != want]
        self.save(rows)
        return rows

    def drop_linked(self, media_ids: Iterable[str]) -> list[dict[str, Any]]:
        used = {str(mid) for mid in media_ids if mid}
        rows = [row for row in self.load() if str(row.get("media_id") or "") not in used]
        self.save(rows)
        return rows


def _parse_utc(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


WINNER_MIN_VIEWS = 10_000
WINNER_MULT = 3.0
QUIET_MAX_VIEWS = 1_000
QUIET_MIN_LINKED = 3
QUIET_MIN_AGE_HOURS = 24
WINNER_COPY = "This original is carrying the week. Generate 20 more of this original."
WEAK_HOLD_COPY = (
    "Viewers bounce early on these copies (skip or short watch). "
    "Try a new original — this looks like the video, not the variant."
)
HELD_NO_PUSH_COPY = (
    "Hold looks fine, but these copies are not getting push versus the rest of this account. "
    "Insights cannot see policy."
)
QUIET_COPY = HELD_NO_PUSH_COPY


def pack_suggestions(
    packs: Sequence[Mapping[str, Any]],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Winner / weak-hold / held-no-push. Never writes flagged. Fresh posts wait."""
    moment = now or datetime.now(UTC)
    linked = [p for p in packs if int(p.get("insights_linked") or 0) > 0]
    scored = [p for p in linked if isinstance(p.get("insights_views"), int)]
    out: list[dict[str, Any]] = []

    def row(kind: str, pack: Mapping[str, Any], copy: str) -> dict[str, Any]:
        return {
            "kind": kind,
            "source_id": pack.get("source_id"),
            "filename": pack.get("filename"),
            "copy": copy,
        }

    account_has_push = any(int(p.get("insights_views") or 0) > QUIET_MAX_VIEWS for p in scored)

    for pack in scored:
        views = int(pack["insights_views"])
        others = [int(p["insights_views"]) for p in scored if p is not pack]
        if others and views >= WINNER_MIN_VIEWS and views >= WINNER_MULT * median(others):
            out.append(row("winner", pack, WINNER_COPY))

    for pack in scored:
        views = int(pack["insights_views"])
        linked_n = int(pack.get("insights_linked") or 0)
        created = _parse_utc(pack.get("created_utc") if isinstance(pack.get("created_utc"), str) else None)
        age_ok = created is not None and (moment - created).total_seconds() >= QUIET_MIN_AGE_HOURS * 3600
        quiet_floor = (
            account_has_push
            and linked_n >= QUIET_MIN_LINKED
            and age_ok
            and views <= QUIET_MAX_VIEWS
        )
        hold = pack.get("hold_kind") if isinstance(pack.get("hold_kind"), str) else None
        if quiet_floor and hold == "weak_hold":
            out.append(row("weak_hold", pack, WEAK_HOLD_COPY))
        elif quiet_floor:
            out.append(row("held_no_push", pack, HELD_NO_PUSH_COPY))

    return out


def _get_json(url: str, timeout: int = 20) -> dict[str, Any]:
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode()
    body = __import__("json").loads(raw)
    if not isinstance(body, dict):
        raise TypeError("Instagram returned a non-object payload")
    err = body.get("error")
    if isinstance(err, dict):
        raise ValueError(str(err.get("message") or err))  # noqa: TRY004
    return body


def _page_media(
    start_url: str,
    fetch: Callable[[str], dict[str, Any]],
    pages: int,
) -> list[dict[str, Any]]:
    url: str | None = start_url
    out: list[dict[str, Any]] = []
    for _ in range(max(1, pages)):
        if not url:
            break
        body = fetch(url)
        rows = body.get("data")
        if isinstance(rows, list):
            out.extend(r for r in rows if isinstance(r, dict))
        paging = body.get("paging") if isinstance(body.get("paging"), dict) else {}
        nxt = paging.get("next") if isinstance(paging, dict) else None
        url = nxt if isinstance(nxt, str) and nxt else None
    return out


def list_media(
    user_id: str,
    access_token: str,
    *,
    get_json: Callable[[str], dict[str, Any]] | None = None,
    pages: int = 3,
) -> list[dict[str, Any]]:
    """List recent media. Instagram Login is token-scoped: try /me/media first.

    `/{IG_ID}/media` is the documented professional-account path. Some tokens
    return an empty `data` list on the wrong id (not an HTTP error), so we
    fall back instead of treating that as "this account has no Reels."
    """
    fetch = get_json or _get_json
    qs = urlencode({
        "fields": "id,caption,permalink,timestamp,media_type,media_product_type,video_duration",
        "limit": "50",
        "access_token": access_token,
    })
    starts = [f"{GRAPH_HOST}/me/media?{qs}"]
    uid = (user_id or "").strip()
    if uid and uid != "me":
        starts.append(f"{GRAPH_HOST}/{uid}/media?{qs}")
    last_err: ValueError | None = None
    saw_success = False
    for start in starts:
        try:
            rows = _page_media(start, fetch, pages)
        except ValueError as exc:
            last_err = exc
            continue
        saw_success = True
        if rows:
            return rows
    if not saw_success and last_err is not None:
        raise last_err
    return []


def fetch_media_insights(
    media_id: str,
    access_token: str,
    *,
    get_json: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, int | float]:
    fetch = get_json or _get_json
    out: dict[str, int | float] = {}
    batches = (
        INSIGHT_METRICS,
        INSIGHT_HOLD_METRICS,
        INSIGHT_CONV_METRICS,
    )
    for metrics in batches:
        qs = urlencode({
            "metric": ",".join(metrics),
            "access_token": access_token,
        })
        url = f"{GRAPH_HOST}/{media_id}/insights?{qs}"
        try:
            out.update(parse_insights_payload(fetch(url)))
        except ValueError:
            if metrics == INSIGHT_METRICS:
                qs2 = urlencode({
                    "metric": "views,likes,comments,saved,shares",
                    "access_token": access_token,
                })
                try:
                    out.update(parse_insights_payload(fetch(f"{GRAPH_HOST}/{media_id}/insights?{qs2}")))
                except ValueError:
                    pass
            continue
    return out
