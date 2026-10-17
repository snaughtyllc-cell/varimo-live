"""On-screen text burned onto a finished variant.

Variants are rendered first. This step lays a sticker on the finished frame,
inside the boxes locked to each caption. Crop and tilt are already done.

Rules:
- Every caption owns at least one box.
- At most four captions and four boxes.
- One caption may use every box. Extra captions each need their own box.
- The first take uses the spot the user previewed. Later takes move inside that box.
- Up to four sounds take turns. The first variant uses the sound listed first.
- A line can name when it comes in and when it leaves. Blank timing stays on the whole clip.
"""
from __future__ import annotations

import math
import os
import subprocess
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

MAX_CAPTIONS = 4
MAX_BOXES = 4
MAX_AUDIOS = 4
MAX_PRINTS = 5
MAX_CHARS = 120
_MAX_CUE = 180.0
SIZE_STEPS = (1.0, 0.9, 0.8)
ALIGNS = ("center", "left", "right")
SPOTS = ("middle", "top", "bottom")
# Inside the box the user drew. First spot matches the untouched preview.
_INSIDE = (
    (0.5, 0.5),
    (0.18, 0.18),
    (0.82, 0.82),
    (0.82, 0.18),
    (0.18, 0.82),
    (0.5, 0.18),
    (0.5, 0.82),
    (0.18, 0.5),
    (0.82, 0.5),
)
SEATS = (
    ("tl", 0.18, 0.18),
    ("tc", 0.5, 0.18),
    ("tr", 0.82, 0.18),
    ("ml", 0.18, 0.5),
    ("mc", 0.5, 0.5),
    ("mr", 0.82, 0.5),
    ("bl", 0.18, 0.82),
    ("bc", 0.5, 0.82),
    ("br", 0.82, 0.82),
)
_SEAT_XY = {seat_id: (x, y) for seat_id, x, y in SEATS}

_FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
_CLASSIC_FONT = os.path.join(_FONT_DIR, "Inter-SemiBold.ttf")
_BAR_FONT = os.path.join(_FONT_DIR, "NotoSans-Bold.ttf")


class OnScreenError(ValueError):
    pass


def _boxes_by_id(boxes: list[dict]) -> dict[str, dict]:
    return {str(b["id"]): b for b in boxes}


def _normalize_audios(raw) -> list[dict]:
    """Keep at most four sounds. The first one is what variant 1 plays."""
    out = []
    for i, item in enumerate(list(raw or [])[:MAX_AUDIOS]):
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        bed_id = str(item.get("bed_id") or "").strip()
        if key and (".." in key.split("/") or key.startswith("/") or "\\" in key):
            key = ""
        if bed_id != os.path.basename(bed_id) or ".." in bed_id:
            bed_id = ""
        if not key and not bed_id:
            continue
        try:
            volume = float(item.get("volume", 0.25))
        except (TypeError, ValueError):
            volume = 0.25
        try:
            start = float(item.get("start") or 0)
        except (TypeError, ValueError):
            start = 0.0
        mode = str(item.get("mode") or "under")
        if mode not in ("under", "replace"):
            mode = "under"
        row = {
            "id": str(item.get("id") or i + 1)[:24],
            "name": (str(item.get("name") or "Sound").strip() or "Sound")[:80],
            "volume": round(min(1.0, max(0.0, volume)), 4),
            "mode": mode,
            "start": round(min(30.0, max(0.0, start)), 3),
        }
        if key:
            row["key"] = key[:240]
        if bed_id:
            row["bed_id"] = bed_id[:32]
        out.append(row)
    return out


def _cue(value) -> float | None:
    """Seconds from 0 to 180, or None when the field is blank."""
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(min(_MAX_CUE, max(0.0, number)), 3)


def _cue_text(number: float) -> str:
    rendered = f"{number:.3f}".rstrip("0").rstrip(".")
    return rendered or "0"


def _window(show, hide) -> tuple[float, float | None]:
    start = _cue(show)
    end = _cue(hide)
    if start is None:
        start = 0.0
    if end is not None and end <= start:
        end = None
    return start, end


def overlay_enable(show, hide) -> str | None:
    """FFmpeg enable expression. None keeps the words on for the whole clip."""
    start, end = _window(show, hide)
    if start <= 0 and end is None:
        return None
    if end is None:
        return f"gte(t,{_cue_text(start)})"
    return f"between(t,{_cue_text(start)},{_cue_text(end)})"


def overlay_graph(show=None, hide=None) -> str:
    enable = overlay_enable(show, hide)
    if not enable:
        return "[0:v][1:v]overlay=0:0[v]"
    return f"[0:v][1:v]overlay=0:0:enable='{enable}'[v]"


def poster_at(placement: dict | None) -> float:
    """Pick a frame that still has the words, so the gallery thumb is not blank."""
    start, end = _window(
        None if not placement else placement.get("show"),
        None if not placement else placement.get("hide"),
    )
    if end is not None:
        return round(min(start + 0.2, (start + end) / 2), 3)
    if start > 0:
        return round(start + 0.2, 3)
    return 0.4


def _normalize_prints(raw) -> list[dict]:
    prints = []
    for item in list(raw or [])[:MAX_PRINTS]:
        if not isinstance(item, dict):
            continue
        inner = dict(item)
        inner.pop("prints", None)
        cleaned = normalize_project(inner, nested=True)
        if cleaned:
            prints.append(cleaned)
    return prints


def normalize_project(raw: dict | None, *, nested: bool = False) -> dict | None:
    """Return a clean project, or None when on-screen text is off."""
    if not raw:
        return None
    captions_in = list(raw.get("captions") or [])
    boxes_in = list(raw.get("boxes") or [])
    if not captions_in and not boxes_in:
        return None
    if not captions_in or not boxes_in:
        raise OnScreenError("Each on-screen caption needs at least one box.")
    if len(captions_in) > MAX_CAPTIONS:
        raise OnScreenError("At most 4 on-screen captions.")
    if len(boxes_in) > MAX_BOXES:
        raise OnScreenError("At most 4 boxes.")

    boxes = []
    seen_boxes: set[str] = set()
    for i, box in enumerate(boxes_in):
        bid = str(box.get("id") or chr(ord("A") + i))
        if bid in seen_boxes:
            raise OnScreenError(f"Duplicate box {bid}.")
        seen_boxes.add(bid)
        x, y, w, h = (float(box["x"]), float(box["y"]), float(box["w"]), float(box["h"]))
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1.001 or y + h > 1.001:
            raise OnScreenError(f"Box {bid} sits outside the frame.")
        row = {"id": bid, "x": x, "y": y, "w": w, "h": h}
        picked = []
        for seat_id in list(box.get("seats") or []):
            seat_id = str(seat_id)
            if seat_id in _SEAT_XY and seat_id not in picked:
                picked.append(seat_id)
        if picked:
            row["seats"] = picked
        boxes.append(row)

    known = _boxes_by_id(boxes)
    captions = []
    used: set[str] = set()
    for i, cap in enumerate(captions_in):
        text = str(cap.get("text") or "").strip()
        if not text:
            raise OnScreenError("An on-screen caption is empty.")
        if len(text) > MAX_CHARS:
            raise OnScreenError("On-screen text is limited to 120 characters.")
        ids = [str(b) for b in (cap.get("box_ids") or [])]
        if not ids:
            raise OnScreenError("Each on-screen caption needs at least one box.")
        for bid in ids:
            if bid not in known:
                raise OnScreenError(f"Caption points at missing box {bid}.")
            if bid in used:
                raise OnScreenError(f"Box {bid} is locked to more than one caption.")
            used.add(bid)
        place = {}
        raw_place = cap.get("place") if isinstance(cap.get("place"), dict) else {}
        for bid in ids:
            spot = raw_place.get(bid)
            if isinstance(spot, dict) and "x" in spot and "y" in spot:
                place[bid] = {
                    "x": min(1.0, max(0.0, float(spot["x"]))),
                    "y": min(1.0, max(0.0, float(spot["y"]))),
                }
        row = {
            "id": str(cap.get("id") or i + 1),
            "text": text,
            "box_ids": ids,
            "place": place,
        }
        if cap.get("size") is not None:
            try:
                row["size"] = min(1.6, max(0.55, float(cap["size"])))
            except (TypeError, ValueError):
                pass
        if str(cap.get("lines")) == "both":
            row["lines"] = "both"
        elif str(cap.get("lines")) in ("1", "2"):
            row["lines"] = int(cap["lines"])
        start, end = _window(cap.get("show"), cap.get("hide"))
        if start > 0:
            row["show"] = start
        if end is not None:
            row["hide"] = end
        captions.append(row)

    if len(used) != len(boxes):
        raise OnScreenError("Every box has to lock to a caption.")

    audios = _normalize_audios(raw.get("audios"))
    look = dict(raw.get("look") or {})
    style = str(look.get("style") or "classic")
    if style not in ("classic", "strong", "caption-bar"):
        raise OnScreenError(f"Unknown on-screen look {style}.")
    background = str(look.get("background") or "solid")
    if style != "caption-bar" and background not in ("none", "plain", "solid", "see-through"):
        raise OnScreenError(f"Unknown background {background}.")
    result = {
        "captions": captions,
        "boxes": boxes,
        "look": {
            "style": style,
            "background": "none" if style == "caption-bar" else background,
            "color": str(look.get("color") or "#FFFFFF"),
        },
    }
    if audios:
        result["audios"] = audios
    if not nested:
        prints = _normalize_prints(raw.get("prints"))
        if prints:
            result["prints"] = prints
    return result


def _chosen_place(take: int, liked: dict | None, seats: list[str]) -> dict:
    """Cycle the seats the user turned on. The preview seat goes first."""
    ordered: list[tuple[float, float]] = []
    if liked:
        for seat_id in seats:
            x, y = _SEAT_XY[seat_id]
            if abs(x - float(liked["x"])) <= 0.08 and abs(y - float(liked["y"])) <= 0.08:
                ordered.append((x, y))
                break
    for seat_id in seats:
        pair = _SEAT_XY[seat_id]
        if pair not in ordered:
            ordered.append(pair)
    x, y = ordered[take % len(ordered)]
    return {"x": x, "y": y}


def _inside_box(take: int, liked: dict | None) -> dict:
    """First take keeps the spot the user is looking at. Later takes move."""
    if take == 0 and liked:
        return {"x": float(liked["x"]), "y": float(liked["y"])}
    spots = list(_INSIDE)
    if liked:
        spots = [
            pair for pair in spots
            if abs(pair[0] - float(liked["x"])) > 0.12 or abs(pair[1] - float(liked["y"])) > 0.12
        ] or list(_INSIDE)
        pair = spots[(take - 1) % len(spots)]
    else:
        pair = spots[take % len(spots)]
    return {"x": pair[0], "y": pair[1]}


def plan_versions(project: dict, count: int) -> list[dict]:
    """One placement per variant index, in order. Same project → same pack."""
    clean = normalize_project(project)
    if clean is None:
        return []
    prints = clean.get("prints") or []
    if prints:
        total = max(0, int(count))
        base, extra = divmod(total, len(prints))
        out = []
        for i, item in enumerate(prints):
            share = base + (1 if i < extra else 0)
            for placement in plan_versions(item, share):
                placement = dict(placement)
                placement["n"] = len(out) + 1
                placement["print"] = i + 1
                out.append(placement)
        return out
    captions = clean["captions"]
    boxes = _boxes_by_id(clean["boxes"])
    look = clean["look"]
    audios = list(clean.get("audios") or [])
    bar = look["style"] == "caption-bar"
    out = []
    for n in range(max(0, int(count))):
        cap = captions[n % len(captions)]
        take = n // len(captions)
        box_id = cap["box_ids"][take % len(cap["box_ids"])]
        placed = (cap.get("place") or {}).get(box_id)
        seats = list(boxes[box_id].get("seats") or [])
        locked_size = cap.get("size")
        if bar:
            step = SIZE_STEPS[take % len(SIZE_STEPS)]
            align, spot = "center", SPOTS[(take // len(SIZE_STEPS)) % len(SPOTS)]
        else:
            step = SIZE_STEPS[take % len(SIZE_STEPS)]
            align = ALIGNS[(take // len(SIZE_STEPS)) % len(ALIGNS)]
            spot = SPOTS[(take // (len(SIZE_STEPS) * len(ALIGNS))) % len(SPOTS)]
        if locked_size is not None:
            step = float(locked_size)
        chosen_lines = cap.get("lines")
        if chosen_lines == "both":
            line_lock = 1 if take % 2 == 0 else 2
        else:
            line_lock = chosen_lines
        row = {
            "n": n + 1,
            "caption_id": cap["id"],
            "text": cap["text"],
            "box_id": box_id,
            "box": dict(boxes[box_id]),
            "size_step": step,
            "align": align,
            "spot": spot,
            "place": _chosen_place(take, placed, seats) if seats else _inside_box(take, placed),
            "lines": line_lock,
            "look": dict(look),
        }
        if "show" in cap:
            row["show"] = cap["show"]
        if "hide" in cap:
            row["hide"] = cap["hide"]
        if audios:
            row["audio"] = dict(audios[n % len(audios)])
        out.append(row)
    return out


def _font(path: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, max(8, int(px)))


def _wrap(
    draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: int,
) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            continue
        cur = words[0]
        for word in words[1:]:
            trial = f"{cur} {word}"
            if draw.textlength(trial, font=font) <= max_w:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines or [text]


def _hex(color: str) -> tuple[int, int, int]:
    raw = color.lstrip("#")
    if len(raw) != 6:
        return (255, 255, 255)
    return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))


def _edge_start(anchor: float, start: int, end: int, size: int) -> float:
    """Park the block on the near edge of a side seat, and keep it inside."""
    room = max(1, end - start)
    if size >= room:
        return float(start)
    if anchor <= 0.34:
        return float(start)
    if anchor >= 0.66:
        return float(end - size)
    pos = start + anchor * room - size / 2
    return float(min(max(start, pos), end - size))


def render_layer(placement: dict, width: int, height: int) -> Image.Image:
    """Transparent full-frame sticker. Overlay it at 0,0."""
    img = Image.new("RGBA", (int(width), int(height)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    box = placement["box"]
    look = placement["look"]
    text = placement["text"]
    if look["style"] == "strong":
        text = text.upper()
    short = min(width, height)
    margin = int(0.03 * short)
    x0 = max(int(box["x"] * width), margin)
    y0 = max(int(box["y"] * height), margin)
    x1 = min(int((box["x"] + box["w"]) * width), width - margin)
    y1 = min(int((box["y"] + box["h"]) * height), height - margin)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    bar = look["style"] == "caption-bar"
    font_path = _BAR_FONT if bar else _CLASSIC_FONT
    base = int((0.042 if bar else 0.062) * short * float(placement["size_step"]))
    max_w = width - 2 * margin if bar else max(8, int(bw * 0.92))
    lock = placement.get("lines")
    font = _font(font_path, base)
    lines = [text]
    while True:
        font = _font(font_path, base)
        if lock == 1:
            lines = [" ".join(text.split()) or text]
        else:
            lines = _wrap(draw, text, font, max_w)
            if lock == 2 and len(lines) > 2:
                lines = [lines[0], " ".join(lines[1:])]
        longest = max(draw.textlength(line, font=font) for line in lines)
        line_h = int(base * (1.22 if bar else 1.30))
        pad_x, pad_y = int(base * 0.42), int(base * 0.18)
        fits = longest + 2 * pad_x <= bw and line_h * len(lines) + 2 * pad_y <= bh
        if bar or fits or base <= 8:
            break
        nxt = max(8, int(base * 0.86))
        if nxt == base:
            break
        base = nxt
    block_h = line_h * len(lines)
    if bar:
        pad_y = int(base * 0.42)
        bar_h = block_h + 2 * pad_y
        placed = placement.get("place")
        if isinstance(placed, dict) and "y" in placed:
            top = y0 + float(placed["y"]) * bh - bar_h / 2
            top = min(max(y0, top), max(y0, y1 - bar_h))
        elif placement["spot"] == "top":
            top = y0
        elif placement["spot"] == "bottom":
            top = max(y0, y1 - bar_h)
        else:
            top = y0 + max(0, (bh - bar_h) // 2)
        draw.rectangle((0, top, width, top + bar_h), fill=(0, 0, 0, 140))
        for i, line in enumerate(lines):
            tw = draw.textlength(line, font=font)
            tx = (width - tw) / 2
            ty = top + pad_y + i * line_h
            draw.text((tx, ty), line, font=font, fill=(255, 255, 255, 255))
        return img

    longest = max(draw.textlength(line, font=font) for line in lines)
    pad_x, pad_y = int(base * 0.42), int(base * 0.18)
    block_w = int(longest + 2 * pad_x)
    block_h = int(line_h * len(lines) + 2 * pad_y)
    placed = placement.get("place")
    pinned = isinstance(placed, dict) and "x" in placed and "y" in placed
    align = "center" if pinned else placement["align"]
    if pinned:
        left = _edge_start(float(placed["x"]), x0, x1, block_w)
        top = _edge_start(float(placed["y"]), y0, y1, block_h)
    else:
        if align == "left":
            left = x0
        elif align == "right":
            left = x1 - block_w
        else:
            left = x0 + (bw - block_w) / 2
        spot = placement["spot"]
        if spot == "top":
            top = y0
        elif spot == "bottom":
            top = y1 - block_h
        else:
            top = y0 + (bh - block_h) / 2
    bg = look["background"]
    if bg == "solid":
        draw.rounded_rectangle(
            (left, top, left + block_w, top + block_h),
            radius=int(base * 0.35),
            fill=(255, 255, 255, 235),
        )
        fill = (17, 18, 22, 255)
    elif bg == "see-through":
        draw.rounded_rectangle(
            (left, top, left + block_w, top + block_h),
            radius=int(base * 0.35),
            fill=(12, 12, 16, 160),
        )
        fill = (255, 255, 255, 255)
    else:
        fill = _hex(look.get("color") or "#FFFFFF") + (255,)
    for i, line in enumerate(lines):
        tw = draw.textlength(line, font=font)
        if align == "left":
            tx = left + pad_x
        elif align == "right":
            tx = left + block_w - pad_x - tw
        else:
            tx = left + (block_w - tw) / 2
        ty = top + pad_y + i * line_h
        if bg == "none":
            draw.text((tx + 1, ty + 2), line, font=font, fill=(0, 0, 0, 140))
        draw.text((tx, ty), line, font=font, fill=fill)
    return img


def burn_file(video_path: str, placement: dict, width: int, height: int, color=None) -> None:
    """Overlay one sticker onto the finished mp4, in place.

    Audio is copied. Color tags from the finished variant are written back so
    the second encode does not drop them.
    """
    from .color import output_color_args

    layer = render_layer(placement, width, height)
    png = video_path + ".onscreen.png"
    out = video_path + ".onscreen.mp4"
    layer.save(png)
    color_args = output_color_args(color) if color is not None else []
    cmd = [
        "ffmpeg", "-y", "-i", video_path, "-i", png,
        "-filter_complex", overlay_graph(placement.get("show"), placement.get("hide")),
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
        "-c:a", "copy",
        *color_args,
        "-movflags", "+faststart",
        out,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        os.replace(out, video_path)
    finally:
        if os.path.exists(png):
            os.remove(png)
        if os.path.exists(out):
            os.remove(out)


def text_poster_name(index: int) -> str:
    return f"look_text_v{int(index):02d}.jpg"


def write_text_poster(video_path: str, out_path: str, at: float = 0.4) -> None:
    """One frame of the finished file, after the words are on it."""
    if os.path.exists(out_path):
        os.remove(out_path)
    duration = _media_duration(video_path)
    stamp = min(max(0.0, float(at)), max(0.0, duration - 0.05))
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{stamp:.3f}", "-i", video_path,
            "-frames:v", "1",
            "-vf", "scale=480:-2",
            "-q:v", "3",
            out_path,
        ],
        check=True,
        capture_output=True,
    )
    if not os.path.isfile(out_path) or os.path.getsize(out_path) <= 0:
        raise OnScreenError("On-screen poster was empty.")


def _has_audio(path: str) -> bool:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type", "-of", "csv=p=0", path,
        ],
        check=False, capture_output=True, text=True,
    )
    return "audio" in (probe.stdout or "")


def _media_duration(path: str) -> float:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", path,
        ],
        check=False, capture_output=True, text=True,
    )
    try:
        return max(0.1, float((probe.stdout or "").strip() or "0"))
    except ValueError:
        return 30.0


def mix_audio(
    video_path: str, bed_path: str, *, mode: str = "under",
    volume: float = 0.25, start: float = 0.0,
) -> None:
    """Lay a bed under the original voice, or replace that voice.

    ``under`` keeps the video's audio and adds the bed at ``volume``.
    A clip with no audio is treated as replace. ``start`` skips into the bed.
    """
    picked = "replace" if str(mode) == "replace" else "under"
    if picked == "under" and not _has_audio(video_path):
        picked = "replace"
    level = min(1.0, max(0.0, float(volume)))
    offset = min(30.0, max(0.0, float(start)))
    dur = _media_duration(video_path)
    out = video_path + ".bed.mp4"
    # Leave the voice's channel layout alone. Forcing stereo ducks a mono
    # talking track by about 3 dB before the bed is even added.
    bed = (
        f"[1:a]volume={level:.4f},atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,"
        f"apad=whole_dur={dur:.3f}[bed]"
    )
    if picked == "replace":
        graph = bed
        audio_map = "[bed]"
    else:
        graph = (
            bed
            + ";[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0:"
            + "normalize=0:weights=1 1[a]"
        )
        audio_map = "[a]"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", video_path,
        "-ss", f"{offset:.3f}", "-i", bed_path,
        "-filter_complex", graph,
        "-map", "0:v:0", "-map", audio_map,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        out,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        os.replace(out, video_path)
    except subprocess.CalledProcessError as exc:
        raise OnScreenError("Could not mix that sound onto the video.") from exc
    finally:
        if os.path.exists(out):
            os.remove(out)


def placement_record(placement: dict) -> dict:
    look = placement.get("look") or {}
    record = {
        "caption_id": placement.get("caption_id"),
        "box_id": placement.get("box_id"),
        "text": placement.get("text"),
        "size_step": placement.get("size_step"),
        "align": placement.get("align"),
        "spot": placement.get("spot"),
        "place": placement.get("place"),
        "style": look.get("style"),
        "background": look.get("background"),
    }
    if placement.get("show") is not None:
        record["show"] = placement["show"]
    if placement.get("hide") is not None:
        record["hide"] = placement["hide"]
    audio = placement.get("audio") if isinstance(placement.get("audio"), dict) else None
    if audio:
        record["audio"] = {
            "name": audio.get("name"),
            "mode": audio.get("mode"),
            "volume": audio.get("volume"),
        }
    return record


@lru_cache(maxsize=1)
def fonts_ready() -> bool:
    return os.path.isfile(_CLASSIC_FONT) and os.path.isfile(_BAR_FONT)
