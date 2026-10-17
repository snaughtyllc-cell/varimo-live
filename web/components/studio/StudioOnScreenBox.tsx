"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, useRef } from "react";
import {
  deleteOnScreenTemplate,
  listOnScreenTemplates,
  saveOnScreenTemplate,
  soundFileKind,
  soundSizeNote,
  type OnScreenTemplate,
} from "@/lib/api";
import { captureVideoFrame } from "@/lib/videoPoster";

export type OnScreenStyle = "classic" | "strong" | "caption-bar";
export type OnScreenBackground = "solid" | "see-through" | "none" | "plain";

export type OnScreenAudio = {
  id: string;
  name: string;
  volume: number;
  mode: "under" | "replace";
  start: number;
  key?: string;
  bed_id?: string;
  file?: File;
};

export type OnScreenCaption = {
  id: string;
  text: string;
  box_ids: string[];
  place?: Record<string, { x: number; y: number }>;
  size?: number;
  lines?: 1 | 2 | "both";
  show?: number;
  hide?: number;
};

export const MAX_SOUNDS = 4;
export const MAX_PRINTS = 5;
export const MAX_PACK = 40;

export function cleanAudios(audios: OnScreenAudio[] | undefined, previewId?: string): OnScreenAudio[] {
  const rows = (audios || []).slice(0, MAX_SOUNDS).flatMap((audio) => {
    const row: OnScreenAudio = {
      id: audio.id,
      name: (audio.name || "Sound").slice(0, 80),
      volume: Math.min(1, Math.max(0, Number(audio.volume ?? 0.25) || 0)),
      mode: audio.mode === "replace" ? "replace" : "under",
      start: Math.min(30, Math.max(0, Number(audio.start) || 0)),
      ...(audio.key ? { key: audio.key } : {}),
      ...(audio.bed_id ? { bed_id: audio.bed_id } : {}),
      ...(audio.file ? { file: audio.file } : {}),
    };
    return row.key || row.bed_id || row.file ? [row] : [];
  });
  const index = previewId ? rows.findIndex((audio) => audio.id === previewId) : 0;
  if (index <= 0) return rows;
  return [...rows.slice(index), ...rows.slice(0, index)];
}

export function printPlan(perVideo: number, prints: number): { each: number; total: number } {
  const n = Math.max(1, Math.min(MAX_PRINTS, Math.floor(prints) || 1));
  const want = Math.max(1, Math.floor(perVideo) || 1);
  const each = Math.max(1, Math.min(want, Math.floor(MAX_PACK / n)));
  return { each, total: each * n };
}

export function projectWithPrints(prints: OnScreenProject[]): OnScreenProject {
  const first = prints[0];
  return { ...first, prints: prints.slice(0, MAX_PRINTS) };
}

export function seatStyle(x: number, y: number): {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform: string;
  transformOrigin: string;
} {
  const col = x <= 0.34 ? "start" : x >= 0.66 ? "end" : "center";
  const row = y <= 0.34 ? "start" : y >= 0.66 ? "end" : "center";
  const style: {
    left?: string;
    right?: string;
    top?: string;
    bottom?: string;
    transform: string;
    transformOrigin: string;
  } = {
    transform: `translate(${col === "center" ? "-50%" : "0"}, ${row === "center" ? "-50%" : "0"})`,
    transformOrigin: `${col === "end" ? "right" : col === "start" ? "left" : "center"} ${row === "end" ? "bottom" : row === "start" ? "top" : "center"}`,
  };
  if (col === "end") {
    style.right = "4%";
    style.left = "auto";
  } else if (col === "center") style.left = "50%";
  else style.left = "4%";
  if (row === "end") {
    style.bottom = "4%";
    style.top = "auto";
  } else if (row === "center") style.top = "50%";
  else style.top = "4%";
  return style;
}

export function textFitWarning(textWidth: number, boxWidth: number): string {
  if (boxWidth <= 0 || textWidth <= boxWidth * 0.92) return "";
  return "This line is too big for that seat. Make it smaller so it stays inside the box.";
}

export function clampTextSize(value: number) {
  const stepped = Math.round(value * 10) / 10;
  return Math.min(1.6, Math.max(0.55, stepped));
}

function cueSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.round(Math.min(180, Math.max(0, number)) * 1000) / 1000;
}

export function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function trackWindow(show: number | undefined, hide: number | undefined, duration: number) {
  const length = Math.max(0.5, duration);
  const start = Math.min(length, Math.max(0, show ?? 0));
  const end = hide === undefined ? length : Math.min(length, Math.max(start + 0.1, hide));
  return { start, end };
}

export function cuesFromTrack(start: number, end: number, duration: number): { show?: number; hide?: number } {
  const length = Math.max(0.5, duration);
  const from = Math.min(length, Math.max(0, start));
  const to = Math.min(length, Math.max(from + 0.1, end));
  if (from <= 0.05 && to >= length - 0.05) return {};
  return captionWindow(from <= 0.05 ? undefined : from, to >= length - 0.05 ? undefined : to);
}

export function captionWindow(show: unknown, hide: unknown): { show?: number; hide?: number } {
  const start = cueSeconds(show);
  let end = cueSeconds(hide);
  if (start === undefined && end === undefined) return {};
  const from = start ?? 0;
  if (end !== undefined && end <= from) end = undefined;
  return {
    ...(from > 0 ? { show: from } : {}),
    ...(end !== undefined ? { hide: end } : {}),
  };
}

export const TEXT_SEATS = [
  { id: "tl", label: "Top left", x: 0.18, y: 0.18 },
  { id: "tc", label: "Top", x: 0.5, y: 0.18 },
  { id: "tr", label: "Top right", x: 0.82, y: 0.18 },
  { id: "ml", label: "Left", x: 0.18, y: 0.5 },
  { id: "mc", label: "Center", x: 0.5, y: 0.5 },
  { id: "mr", label: "Right", x: 0.82, y: 0.5 },
  { id: "bl", label: "Bottom left", x: 0.18, y: 0.82 },
  { id: "bc", label: "Bottom", x: 0.5, y: 0.82 },
  { id: "br", label: "Bottom right", x: 0.82, y: 0.82 },
] as const;

export type OnScreenBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  seats?: string[];
};

export type OnScreenProject = {
  captions: OnScreenCaption[];
  boxes: OnScreenBox[];
  chooseSeats?: boolean;
  look: { style: OnScreenStyle; background: OnScreenBackground; color: string };
  audios?: OnScreenAudio[];
  previewAudio?: string;
  prints?: OnScreenProject[];
};

export const BOX_COLORS = [
  { id: "cyan", label: "Cyan", hex: "#14b8c4" },
  { id: "amber", label: "Amber", hex: "#e39b12" },
  { id: "pink", label: "Pink", hex: "#e85d8c" },
  { id: "violet", label: "Violet", hex: "#7c5cff" },
] as const;

export const FRAME_PRESETS = [
  { id: "9:16", w: 9, h: 16 },
  { id: "3:4", w: 3, h: 4 },
  { id: "4:5", w: 4, h: 5 },
  { id: "1:1", w: 1, h: 1 },
  { id: "4:3", w: 4, h: 3 },
  { id: "16:9", w: 16, h: 9 },
] as const;

export function frameAspect(
  preset: string | null,
  width?: number,
  height?: number,
): { css: string; w: number; h: number } {
  const picked = FRAME_PRESETS.find((item) => item.id === preset);
  if (picked) return { css: `${picked.w} / ${picked.h}`, w: picked.w, h: picked.h };
  if (width && height && width > 0 && height > 0) {
    return { css: `${Math.round(width)} / ${Math.round(height)}`, w: width, h: height };
  }
  return { css: "9 / 16", w: 9, h: 16 };
}

const MIN_BOX = 0.06;
export const REEL_SAFE = { top: 0.08, bottom: 0.08, right: 0.14 };
const HANDLES = ["nw", "ne", "sw", "se"] as const;

type Handle = (typeof HANDLES)[number];

export function emptyOnScreen(): OnScreenProject {
  return {
    captions: [{ id: "1", text: "", box_ids: [] }],
    boxes: [],
    audios: [],
    look: { style: "classic", background: "solid", color: "#FFFFFF" },
  };
}

export function draftFromSaved(project: OnScreenProject): OnScreenProject {
  const boxes = (project.boxes || []).map((box) => ({
    ...box,
    color: BOX_COLORS.find((color) => color.id === box.id)?.hex || box.color || "#14b8c4",
  }));
  const blank = emptyOnScreen();
  return {
    captions: project.captions?.length ? project.captions : blank.captions,
    boxes,
    chooseSeats: boxes.some((box) => (box.seats || []).length > 0),
    look: project.look || blank.look,
    audios: project.audios || [],
    previewAudio: project.audios?.[0]?.id,
  };
}

export function rectFromPoints(x0: number, y0: number, x1: number, y1: number) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

export function clampBox(box: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(1, Math.max(MIN_BOX, box.w));
  const h = Math.min(1, Math.max(MIN_BOX, box.h));
  return {
    x: Math.min(Math.max(0, box.x), 1 - w),
    y: Math.min(Math.max(0, box.y), 1 - h),
    w,
    h,
  };
}

function pointInFrame(event: { clientX: number; clientY: number }, frame: DOMRect) {
  const x = (event.clientX - frame.left) / frame.width;
  const y = (event.clientY - frame.top) / frame.height;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

export function projectFromDraft(draft: OnScreenProject): OnScreenProject | string {
  const boxes = draft.boxes.slice(0, 4).map((box) => {
    const fitted = clampBox(box);
    const seats = draft.chooseSeats
      ? (box.seats || []).filter((id, index, all) => TEXT_SEATS.some((seat) => seat.id === id) && all.indexOf(id) === index)
      : [];
    return { id: box.id, ...fitted, color: box.color, ...(seats.length ? { seats } : {}) };
  });
  const known = new Set(boxes.map((box) => box.id));
  const captions = draft.captions
    .map((cap, i) => {
      const box_ids = cap.box_ids.filter((id) => known.has(id));
      const place: Record<string, { x: number; y: number }> = {};
      for (const id of box_ids) {
        const spot = cap.place?.[id];
        place[id] = {
          x: Math.min(1, Math.max(0, spot?.x ?? 0.5)),
          y: Math.min(1, Math.max(0, spot?.y ?? 0.5)),
        };
      }
      return {
        id: String(i + 1),
        text: cap.text.trim(),
        box_ids,
        place,
        ...(cap.size ? { size: clampTextSize(cap.size) } : {}),
        ...(cap.lines === 1 || cap.lines === 2 || cap.lines === "both" ? { lines: cap.lines } : {}),
        ...captionWindow(cap.show, cap.hide),
      };
    })
    .filter((cap) => cap.text || cap.box_ids.length);
  if (captions.length === 0) return "Add one on-screen line.";
  if (captions.length > 4) return "At most 4 on-screen lines.";
  if (captions.some((cap) => !cap.text)) return "Each on-screen line needs words.";
  if (captions.some((cap) => cap.box_ids.length === 0)) return "Each line needs a box.";
  const used = captions.flatMap((cap) => cap.box_ids);
  if (new Set(used).size !== used.length) return "Each box locks to one line.";
  if (boxes.some((box) => !used.includes(box.id))) return "Lock every colored box to a line.";
  const audios = cleanAudios(draft.audios, draft.previewAudio);
  return {
    captions,
    boxes,
    look: draft.look,
    ...(audios.length ? { audios } : {}),
  };
}

export function captionsWithNewBox(captions: OnScreenCaption[], boxId: string) {
  const open = captions.findIndex((cap) => cap.box_ids.length === 0);
  const index = open >= 0 ? open : captions.length === 1 ? 0 : -1;
  if (index < 0) return captions;
  return captions.map((cap, i) => (
    i === index ? { ...cap, box_ids: [...cap.box_ids, boxId] } : cap
  ));
}

function nextColor(boxes: OnScreenBox[]) {
  const used = new Set(boxes.map((box) => box.id));
  return BOX_COLORS.find((color) => !used.has(color.id)) ?? null;
}

function colorOf(box: OnScreenBox) {
  return BOX_COLORS.find((color) => color.id === box.id)?.hex || box.color;
}

export type OnScreenPreview = {
  key: string;
  name: string;
  file?: File;
  src?: string;
  width?: number;
  height?: number;
};

export function projectsForSources(
  sources: { key: string; name: string }[],
  byKey: Record<string, OnScreenProject>,
): OnScreenProject[] | string {
  const out: OnScreenProject[] = [];
  for (const source of sources) {
    const built = projectFromDraft(byKey[source.key] ?? emptyOnScreen());
    if (typeof built === "string") return `${source.name}: ${built}`;
    out.push(built);
  }
  return out;
}
export function clockTenths(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe - minutes * 60;
  return `${minutes}:${remain.toFixed(1).padStart(4, "0")}`;
}

export function lineOnAt(cap: OnScreenCaption, time: number, duration: number) {
  const span = trackWindow(cap.show, cap.hide, duration);
  return time >= span.start - 0.001 && time <= span.end + 0.001;
}

// Room for a new line: a wide band inside the Reel safe edges, stacked under any lines already there.
export function newLineBox(count: number) {
  const y = [0.34, 0.56, 0.16, 0.7][count % 4];
  return clampBox({ x: 0.06, y, w: 1 - REEL_SAFE.right - 0.08, h: 0.16 });
}

export function addLine(draft: OnScreenProject): { next: OnScreenProject; index: number } | null {
  const color = nextColor(draft.boxes);
  if (!color) return null;
  const open = draft.captions.findIndex((cap) => cap.box_ids.length === 0);
  if (open < 0 && draft.captions.length >= 4) return null;
  const box: OnScreenBox = { id: color.id, color: color.hex, ...newLineBox(draft.boxes.length) };
  const captions = open >= 0
    ? draft.captions.map((cap, i) => (i === open ? { ...cap, box_ids: [color.id] } : cap))
    : [...draft.captions, { id: String(draft.captions.length + 1), text: "", box_ids: [color.id] }];
  return { next: { ...draft, boxes: [...draft.boxes, box], captions }, index: open >= 0 ? open : captions.length - 1 };
}

export function removeLine(draft: OnScreenProject, index: number): OnScreenProject {
  const cap = draft.captions[index];
  if (!cap) return draft;
  const gone = new Set(cap.box_ids);
  const captions = draft.captions.filter((_, i) => i !== index);
  return {
    ...draft,
    boxes: draft.boxes.filter((box) => !gone.has(box.id)),
    captions: captions.length ? captions : emptyOnScreen().captions,
  };
}

// Drag the words. Past the edge of their area, the area comes along.
export function dragWords(
  box: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number },
) {
  let x = box.x;
  let y = box.y;
  if (target.x < x + 0.08 * box.w) x = target.x - 0.08 * box.w;
  if (target.x > x + 0.92 * box.w) x = target.x - 0.92 * box.w;
  if (target.y < y + 0.08 * box.h) y = target.y - 0.08 * box.h;
  if (target.y > y + 0.92 * box.h) y = target.y - 0.92 * box.h;
  const fitted = clampBox({ ...box, x, y });
  return {
    box: fitted,
    place: {
      x: Math.min(0.92, Math.max(0.08, (target.x - fitted.x) / fitted.w)),
      y: Math.min(0.92, Math.max(0.08, (target.y - fitted.y) / fitted.h)),
    },
  };
}

const LOOKS = [
  { key: "classic", name: "Instagram sticker", label: "Sticker" },
  { key: "strong", name: "Strong", label: "Strong" },
  { key: "caption-bar", name: "Snapchat bar", label: "Snap" },
  { key: "solid", name: "Solid", label: "Solid" },
  { key: "see-through", name: "See-through", label: "See-through" },
  { key: "plain", name: "No shadow", label: "No shadow" },
  { key: "none", name: "Shadow", label: "Shadow" },
] as const;

type StageDrag =
  | { kind: "text"; pointerId: number; index: number; boxId: string; ox: number; oy: number; x0: number; y0: number; moved: boolean }
  | { kind: "resize"; pointerId: number; id: string; handle: Handle };

type LaneDrag = {
  pointerId: number;
  index: number;
  mode: "start" | "end" | "move";
  x0: number;
  grab: number;
  show: number;
  hide: number;
  moved: boolean;
};

type Sheet = "sound" | "setups" | "ratio" | "fit" | null;

async function filmstrip(url: string, duration: number, count: number): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("no frames"));
    window.setTimeout(() => reject(new Error("slow")), 5000);
  });
  const canvas = document.createElement("canvas");
  const scale = 72 / Math.max(1, video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.min(duration - 0.05, ((i + 0.5) / count) * duration);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = Math.max(0, at);
      window.setTimeout(resolve, 1200);
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    out.push(canvas.toDataURL("image/jpeg", 0.6));
  }
  video.removeAttribute("src");
  video.load();
  return out;
}

export function StudioOnScreenBox({
  enabled,
  onEnabledChange,
  draft: sharedDraft,
  onChange: onSharedChange,
  projects,
  onProjectsChange,
  sources = [],
  perVideo = 4,
  onPrintsChange,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  draft: OnScreenProject;
  onChange: (next: OnScreenProject) => void;
  projects?: Record<string, OnScreenProject>;
  onProjectsChange?: (next: Record<string, OnScreenProject>) => void;
  sources?: OnScreenPreview[];
  perVideo?: number;
  onPrintsChange?: (prints: OnScreenProject[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editRef = useRef<HTMLSpanElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const dragRef = useRef<StageDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  const laneDrag = useRef<LaneDrag | null>(null);
  const scrubbing = useRef<number | null>(null);
  const [open, setOpen] = useState(enabled);
  const [clipIndex, setClipIndex] = useState(0);
  const [poster, setPoster] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [frames, setFrames] = useState<string[]>([]);
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fitWarning, setFitWarning] = useState("");
  const [templates, setTemplates] = useState<OnScreenTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [pickedPrints, setPickedPrints] = useState<string[]>([]);
  const [setupNote, setSetupNote] = useState("");
  const [playing, setPlaying] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [duration, setDuration] = useState(15);
  const [selectedSound, setSelectedSound] = useState("");
  const soundInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");
  const previewAudioRef = useRef<HTMLMediaElement | null>(null);
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);
  const [framePreset, setFramePreset] = useState<string | null>(null);
  const clip = sources[Math.min(clipIndex, Math.max(0, sources.length - 1))];
  const draft = projects && clip ? (projects[clip.key] ?? emptyOnScreen()) : sharedDraft;
  const live = enabled && open;

  function onChange(next: OnScreenProject) {
    if (projects && clip && onProjectsChange) {
      onProjectsChange({ ...projects, [clip.key]: next });
      return;
    }
    onSharedChange(next);
  }
  const aspect = frameAspect(framePreset, sourceSize?.w, sourceSize?.h);

  function pickClip(index: number) {
    if (index === clipIndex) return;
    videoRef.current?.pause();
    setActive(null);
    setEditing(null);
    setSheet(null);
    setTime(0);
    setIsPlaying(false);
    setFrames([]);
    setClipIndex(index);
  }

  useEffect(() => {
    if (!clip) {
      setPoster("");
      setSourceSize(null);
      setVideoUrl("");
      return;
    }
    if (!clip.file) {
      setPoster(clip.src || "");
      setSourceSize(clip.width && clip.height ? { w: clip.width, h: clip.height } : null);
      setVideoUrl("");
      return;
    }
    let cancel = false;
    const url = URL.createObjectURL(clip.file);
    setVideoUrl(url);
    captureVideoFrame(clip.file)
      .then((frame) => {
        if (cancel) return;
        setPoster(frame.poster);
        setSourceSize({ w: frame.width, h: frame.height });
        setDuration(frame.duration > 0.2 ? frame.duration : 15);
      })
      .catch(() => {
        if (!cancel) {
          setPoster(clip.src || "");
          setSourceSize(null);
        }
      });
    return () => {
      cancel = true;
      URL.revokeObjectURL(url);
    };
  }, [clip?.key, clip?.file, clip?.src, clip?.width, clip?.height]);

  useEffect(() => {
    if (!live || !videoUrl || duration <= 0.2) return;
    let cancel = false;
    filmstrip(videoUrl, duration, 10)
      .then((rows) => {
        if (!cancel) setFrames(rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [live, videoUrl, duration]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setTime(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  useEffect(() => {
    if (!live) return;
    let cancel = false;
    listOnScreenTemplates()
      .then((rows) => {
        if (!cancel) setTemplates(rows);
      })
      .catch(() => {
        if (!cancel) setTemplates([]);
      });
    return () => {
      cancel = true;
    };
  }, [live]);

  useEffect(() => {
    if (editing === null) return;
    const node = editRef.current;
    if (!node) return;
    node.textContent = draft.captions[editing]?.text || "";
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const picked = window.getSelection?.();
    picked?.removeAllRanges();
    picked?.addRange(range);
    // Only when a new line opens for typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    const index = active ?? 0;
    const cap = draft.captions[index];
    const node = frameRef.current?.querySelector(`[data-role='text'][data-line='${index}']`) as HTMLElement | null;
    const box = cap ? draft.boxes.find((item) => item.id === cap.box_ids[0]) : undefined;
    if (!node || !box || draft.look.style === "caption-bar") {
      setFitWarning("");
      return;
    }
    // The words wrap at 92% of their area. Only a word that still spills over is too big.
    setFitWarning(textFitWarning(node.scrollWidth, (node.clientWidth + 1) / 0.92));
  }, [draft, poster, active]);

  function closeEditor(next: boolean) {
    setOpen(next);
    if (next) return;
    videoRef.current?.pause();
    setIsPlaying(false);
    previewAudioRef.current?.pause();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setPlaying("");
    finishEditing();
    setActive(null);
    setSheet(null);
  }

  function seek(seconds: number) {
    const at = Math.min(duration, Math.max(0, seconds));
    setTime(at);
    const video = videoRef.current;
    if (video && Number.isFinite(at)) {
      try {
        video.currentTime = at;
      } catch {
        // Not loaded yet.
      }
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (!video.paused) {
      video.pause();
      setIsPlaying(false);
      return;
    }
    if (time >= duration - 0.05) seek(0);
    void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }

  function patchCaption(index: number, next: Partial<OnScreenCaption>) {
    const captions = draft.captions.map((cap, i) => (i === index ? { ...cap, ...next } : cap));
    onChange({ ...draft, captions });
  }

  function select(index: number | null) {
    if (editing !== null && editing !== index) finishEditing();
    setActive(index);
    if (index === null && sheet === "fit") setSheet(null);
  }

  function startLine() {
    const added = addLine(draft);
    if (!added) {
      setSetupNote("At most 4 lines.");
      return;
    }
    setSetupNote("");
    onChange(added.next);
    setSheet(null);
    setActive(added.index);
    setEditing(added.index);
  }

  function finishEditing() {
    if (editing === null) return;
    const index = editing;
    setEditing(null);
    const cap = draft.captions[index];
    if (cap && !cap.text.trim() && cap.box_ids.length) {
      onChange(removeLine(draft, index));
      setActive(null);
    }
  }

  function deleteLine(index: number) {
    setEditing(null);
    setActive(null);
    setSheet(null);
    onChange(removeLine(draft, index));
  }

  function setLook(key: (typeof LOOKS)[number]["key"]) {
    if (key === "classic" || key === "strong" || key === "caption-bar") {
      onChange({ ...draft, look: { ...draft.look, style: key } });
      return;
    }
    const style = draft.look.style === "caption-bar" ? "classic" : draft.look.style;
    onChange({ ...draft, look: { ...draft.look, style, background: key } });
  }

  function toggleSeat(seatId: string) {
    const cap = active !== null ? draft.captions[active] : undefined;
    const seat = TEXT_SEATS.find((item) => item.id === seatId);
    const box = draft.boxes.find((item) => item.id === cap?.box_ids[0]) || draft.boxes[0];
    if (!seat || !box) return;
    const current = box.seats || [];
    const turningOff = current.includes(seatId);
    const seats = turningOff ? current.filter((id) => id !== seatId) : [...current, seatId];
    const nextSeat = TEXT_SEATS.find((item) => item.id === seats[0]);
    onChange({
      ...draft,
      chooseSeats: true,
      boxes: draft.boxes.map((item) => (item.id === box.id ? { ...item, seats } : item)),
      captions: draft.captions.map((line) => {
        if (!line.box_ids.includes(box.id)) return line;
        const place = { ...(line.place || {}) };
        if (!turningOff) place[box.id] = { x: seat.x, y: seat.y };
        else if (nextSeat) place[box.id] = { x: nextSeat.x, y: nextSeat.y };
        return { ...line, place };
      }),
    });
  }

  function toggleLine(index: number, which: 1 | 2) {
    const current = draft.captions[index]?.lines;
    const has1 = current === 1 || current === "both";
    const has2 = current === 2 || current === "both";
    const next1 = which === 1 ? !has1 : has1;
    const next2 = which === 2 ? !has2 : has2;
    const lines = next1 && next2 ? "both" as const : next1 ? 1 : next2 ? 2 : undefined;
    patchCaption(index, { lines });
  }

  function addSpot(index: number) {
    const cap = draft.captions[index];
    const color = nextColor(draft.boxes);
    const from = draft.boxes.find((box) => box.id === cap?.box_ids[0]);
    if (!cap || !color || !from) return;
    const box = { id: color.id, color: color.hex, ...clampBox({ ...from, y: from.y + from.h + 0.04 > 0.8 ? from.y - from.h - 0.04 : from.y + from.h + 0.04 }) };
    onChange({
      ...draft,
      boxes: [...draft.boxes, box],
      captions: draft.captions.map((line, i) => (i === index ? { ...line, box_ids: [...line.box_ids, color.id] } : line)),
    });
  }

  function removeSpot(index: number, boxId: string) {
    const cap = draft.captions[index];
    if (!cap || cap.box_ids.length <= 1) return;
    onChange({
      ...draft,
      boxes: draft.boxes.filter((box) => box.id !== boxId),
      captions: draft.captions.map((line, i) => (i === index ? { ...line, box_ids: line.box_ids.filter((id) => id !== boxId) } : line)),
    });
  }

  function patchAudio(id: string, next: Partial<OnScreenAudio>) {
    onChange({
      ...draft,
      audios: (draft.audios || []).map((audio) => (audio.id === id ? { ...audio, ...next } : audio)),
    });
  }

  function addSounds(list: FileList | null) {
    const incoming = Array.from(list || []).filter((file) => soundFileKind(file));
    if (!incoming.length) return;
    const tooBig = incoming.find((file) => soundSizeNote(file));
    if (tooBig) {
      setSetupNote(soundSizeNote(tooBig) || "That file is too big.");
      return;
    }
    const room = MAX_SOUNDS - (draft.audios || []).length;
    if (room <= 0) {
      setSetupNote("At most 4 sounds.");
      return;
    }
    const added: OnScreenAudio[] = incoming.slice(0, room).map((file, index) => ({
      id: `s${Date.now().toString(36)}${index}`,
      name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Sound",
      volume: 0.25,
      mode: "under",
      start: 0,
      file,
    }));
    setSetupNote("");
    setSheet("sound");
    setSelectedSound(added[0].id);
    onChange({
      ...draft,
      audios: [...(draft.audios || []), ...added],
      previewAudio: draft.previewAudio || added[0].id,
    });
  }

  function removeSound(id: string) {
    const audios = (draft.audios || []).filter((audio) => audio.id !== id);
    onChange({
      ...draft,
      audios,
      previewAudio: draft.previewAudio === id ? audios[0]?.id : draft.previewAudio,
    });
    if (playing === id) {
      previewAudioRef.current?.pause();
      setPlaying("");
    }
  }

  function playSound(audio: OnScreenAudio) {
    const el = previewAudioRef.current || document.createElement("video");
    previewAudioRef.current = el;
    setSelectedSound(audio.id);
    if (playing === audio.id) {
      el.pause();
      setPlaying("");
      return;
    }
    let src = "";
    if (audio.file) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      src = URL.createObjectURL(audio.file);
      previewUrlRef.current = src;
    } else if (audio.bed_id) {
      src = `/api/onscreen/beds/${audio.bed_id}`;
    }
    if (!src) return;
    el.src = src;
    el.onended = () => setPlaying("");
    void el.play().then(() => setPlaying(audio.id)).catch(() => setSetupNote("Could not play that sound."));
    onChange({ ...draft, previewAudio: audio.id });
  }

  function setSoundMode(audio: OnScreenAudio, mode: "under" | "replace") {
    const volume = mode === "replace" && audio.volume <= 0.25
      ? 1
      : mode === "under" && audio.volume === 1
        ? 0.25
        : audio.volume;
    patchAudio(audio.id, { mode, volume });
  }

  function reportPrints(ids: string[], rows: OnScreenTemplate[] = templates) {
    const picked = rows.filter((row) => ids.includes(row.id)).slice(0, MAX_PRINTS);
    onPrintsChange?.(picked.map((row) => draftFromSaved(row.project as OnScreenProject)));
  }

  function togglePrint(id: string) {
    setPickedPrints((prev) => {
      const next = prev.includes(id)
        ? prev.filter((item) => item !== id)
        : prev.length >= MAX_PRINTS
          ? prev
          : [...prev, id];
      reportPrints(next);
      return next;
    });
  }

  async function saveSetup() {
    const built = projectFromDraft(draft);
    if (typeof built === "string") {
      setSetupNote(built);
      return;
    }
    const name = templateName.trim();
    if (!name) {
      setSetupNote("Name this setup.");
      return;
    }
    setSetupNote("");
    try {
      const saved = await saveOnScreenTemplate(name, built);
      const rows = [saved, ...templates.filter((row) => row.id !== saved.id)];
      setTemplates(rows);
      setTemplateName("");
      setSetupNote("Saved. Check it to print this setup on the next clips.");
    } catch (err) {
      setSetupNote(err instanceof Error ? err.message : "Could not save that setup.");
    }
  }

  async function removeSetup(id: string) {
    try {
      await deleteOnScreenTemplate(id);
    } catch (err) {
      setSetupNote(err instanceof Error ? err.message : "Could not delete that setup.");
      return;
    }
    const rows = templates.filter((row) => row.id !== id);
    setTemplates(rows);
    setPickedPrints((prev) => {
      const next = prev.filter((item) => item !== id);
      reportPrints(next, rows);
      return next;
    });
  }

  function framePoint(event: { clientX: number; clientY: number }) {
    const node = frameRef.current;
    if (!node) return { x: 0, y: 0 };
    return pointInFrame(event, node.getBoundingClientRect());
  }

  function onStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const handle = target.dataset.handle as Handle | undefined;
    const boxId = target.dataset.boxId;
    const line = target.closest("[data-line]") as HTMLElement | null;
    const index = line ? Number(line.dataset.line) : -1;
    if (handle && boxId) {
      dragRef.current = { kind: "resize", pointerId: event.pointerId, id: boxId, handle };
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (index >= 0 && line?.dataset.role === "text") {
      if (editing === index) return;
      const cap = draft.captions[index];
      const box = draft.boxes.find((item) => item.id === cap?.box_ids[0]);
      if (!cap || !box) return;
      const spot = cap.place?.[box.id] ?? { x: 0.5, y: 0.5 };
      const point = framePoint(event);
      dragRef.current = {
        kind: "text",
        pointerId: event.pointerId,
        index,
        boxId: box.id,
        ox: point.x - (box.x + spot.x * box.w),
        oy: point.y - (box.y + spot.y * box.h),
        x0: event.clientX,
        y0: event.clientY,
        moved: false,
      };
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (editing !== null || active !== null) {
      select(null);
      return;
    }
    togglePlay();
  }

  function onStagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = framePoint(event);
    if (drag.kind === "text") {
      const far = Math.abs(event.clientX - drag.x0) + Math.abs(event.clientY - drag.y0) > 4;
      if (!drag.moved && !far) return;
      drag.moved = true;
      const cap = draft.captions[drag.index];
      const box = draft.boxes.find((item) => item.id === drag.boxId);
      if (!cap || !box) return;
      const bar = draft.look.style === "caption-bar";
      const spot = cap.place?.[box.id] ?? { x: 0.5, y: 0.5 };
      const moved = dragWords(box, {
        x: bar ? box.x + spot.x * box.w : point.x - drag.ox,
        y: point.y - drag.oy,
      });
      onChange({
        ...draft,
        boxes: draft.boxes.map((item) => (item.id === box.id ? { ...item, ...moved.box } : item)),
        captions: draft.captions.map((line, i) => (
          i === drag.index ? { ...line, place: { ...(line.place || {}), [box.id]: moved.place } } : line
        )),
      });
      return;
    }
    const box = draft.boxes.find((item) => item.id === drag.id);
    if (!box) return;
    let { x, y, w, h } = box;
    const right = x + w;
    const bottom = y + h;
    if (drag.handle === "nw" || drag.handle === "sw") {
      x = Math.min(point.x, right - MIN_BOX);
      w = right - x;
    } else {
      w = Math.max(MIN_BOX, point.x - x);
    }
    if (drag.handle === "nw" || drag.handle === "ne") {
      y = Math.min(point.y, bottom - MIN_BOX);
      h = bottom - y;
    } else {
      h = Math.max(MIN_BOX, point.y - y);
    }
    const next = clampBox({ x, y, w, h });
    onChange({
      ...draft,
      boxes: draft.boxes.map((item) => (item.id === box.id ? { ...item, ...next } : item)),
    });
  }

  function onStagePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "text" && !drag.moved) {
      if (active === drag.index) {
        videoRef.current?.pause();
        setIsPlaying(false);
        setEditing(drag.index);
      } else {
        select(drag.index);
      }
    } else if (drag.kind === "text") {
      setActive(drag.index);
    }
    dragRef.current = null;
    setDragging(false);
  }

  function rulerSeconds(clientX: number) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  }

  function onRulerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    videoRef.current?.pause();
    setIsPlaying(false);
    scrubbing.current = event.pointerId;
    seek(rulerSeconds(event.clientX));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onRulerPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (scrubbing.current !== event.pointerId) return;
    seek(rulerSeconds(event.clientX));
  }

  function onRulerPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (scrubbing.current === event.pointerId) scrubbing.current = null;
  }

  function onLanePointerDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    const cap = draft.captions[index];
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!cap || !rect || rect.width <= 0) return;
    const span = trackWindow(cap.show, cap.hide, duration);
    const role = (event.target as HTMLElement).dataset.trim;
    const mode = role === "start" ? "start" : role === "end" ? "end" : "move";
    laneDrag.current = {
      pointerId: event.pointerId,
      index,
      mode,
      x0: event.clientX,
      grab: rulerSeconds(event.clientX),
      show: span.start,
      hide: span.end,
      moved: false,
    };
    videoRef.current?.pause();
    setIsPlaying(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  }

  function onLanePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const lane = laneDrag.current;
    if (!lane || lane.pointerId !== event.pointerId) return;
    if (!lane.moved && Math.abs(event.clientX - lane.x0) < 4) return;
    lane.moved = true;
    const seconds = rulerSeconds(event.clientX);
    let show = lane.show;
    let hide = lane.hide;
    if (lane.mode === "start") {
      show = Math.min(lane.hide - 0.2, Math.max(0, seconds));
      seek(show);
    } else if (lane.mode === "end") {
      hide = Math.max(lane.show + 0.2, Math.min(duration, seconds));
      seek(hide);
    } else {
      const span = lane.hide - lane.show;
      show = lane.show + (seconds - lane.grab);
      hide = show + span;
      if (show < 0) {
        show = 0;
        hide = span;
      }
      if (hide > duration) {
        hide = duration;
        show = Math.max(0, duration - span);
      }
      seek(show);
    }
    const cues = cuesFromTrack(show, hide, duration);
    patchCaption(lane.index, { show: cues.show, hide: cues.hide });
  }

  function onLanePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const lane = laneDrag.current;
    if (!lane || lane.pointerId !== event.pointerId) return;
    laneDrag.current = null;
    if (!lane.moved) select(lane.index);
  }

  const audios = draft.audios || [];
  const activeSound = audios.find((audio) => audio.id === (selectedSound || draft.previewAudio)) || audios[0];
  const lines = draft.captions
    .map((cap, index) => ({ cap, index, box: draft.boxes.find((box) => box.id === cap.box_ids[0]) }))
    .filter((row): row is { cap: OnScreenCaption; index: number; box: OnScreenBox } => !!row.box);
  const picked = active !== null ? draft.captions[active] : undefined;
  const pickedBox = picked ? draft.boxes.find((box) => box.id === picked.box_ids[0]) : undefined;
  const bar = draft.look.style === "caption-bar";
  const lookOn = (key: string) => (
    key === "classic" || key === "strong" || key === "caption-bar"
      ? draft.look.style === key
      : !bar && draft.look.background === key
  );
  const pct = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <section className="studio-onscreen" data-testid="studio-onscreen" aria-label="On-screen text">
      <label className="studio-option-row studio-caption-toggle">
        <div>
          <div className="studio-option-row__label">On-screen text</div>
          <div className="studio-option-row__hint">Text, sound, and saved setups on this clip. Post captions stay separate.</div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            onEnabledChange(e.target.checked);
            if (e.target.checked) setOpen(true);
          }}
        />
        <span className="studio-switch" data-on={enabled} aria-hidden="true">
          <span className="studio-switch__thumb" />
        </span>
      </label>
      {enabled && !open && (
        <button type="button" className="studio-onscreen__add" onClick={() => setOpen(true)}>
          Edit{lines.length > 0 ? ` · ${lines.length}` : ""}
        </button>
      )}
      <Dialog.Root open={live} onOpenChange={closeEditor}>
        <Dialog.Portal>
          <Dialog.Overlay className="studio-onscreen__overlay" />
          <Dialog.Content className="studio-onscreen__sheet" aria-describedby={undefined} onOpenAutoFocus={(event) => event.preventDefault()}>
            <div className="studio-onscreen__sheet-head">
              <Dialog.Close className="studio-onscreen__back" type="button" aria-label="Close">
                <span className="material-symbols-rounded" aria-hidden="true">close</span>
              </Dialog.Close>
              <Dialog.Title className="studio-onscreen__title">Edit</Dialog.Title>
              {sources.length > 1 && (
                <div className="studio-onscreen__clips" role="group" aria-label="Clip preview">
                  {sources.map((source, index) => (
                    <button
                      key={source.key}
                      type="button"
                      className="studio-onscreen__clip"
                      data-on={index === Math.min(clipIndex, sources.length - 1)}
                      onClick={() => pickClip(index)}
                    >
                      {source.name}
                    </button>
                  ))}
                </div>
              )}
              <Dialog.Close className="studio-onscreen__done" type="button">Done</Dialog.Close>
            </div>
            <div className="studio-onscreen__body">
              <div
                className="studio-onscreen__stage"
                style={{ ["--frame-w" as string]: String(aspect.w), ["--frame-h" as string]: String(aspect.h) }}
              >
                <div
                  ref={frameRef}
                  className="studio-onscreen__screen"
                  data-testid="onscreen-phone"
                  data-portrait={aspect.h >= aspect.w}
                  data-dragging={dragging}
                  style={{
                    aspectRatio: aspect.css,
                    ["--frame-w" as string]: String(aspect.w),
                    ["--frame-h" as string]: String(aspect.h),
                  }}
                  onPointerDown={onStagePointerDown}
                  onPointerMove={onStagePointerMove}
                  onPointerUp={onStagePointerUp}
                >
                  {videoUrl ? (
                    <video
                      ref={videoRef}
                      className="studio-onscreen__poster"
                      src={videoUrl}
                      poster={poster || undefined}
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(event) => {
                        const length = event.currentTarget.duration;
                        if (Number.isFinite(length) && length > 0.2) setDuration(length);
                      }}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                    />
                  ) : poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="studio-onscreen__poster" src={poster} alt="" />
                  ) : null}
                  {aspect.h >= aspect.w && (
                    <div className="studio-onscreen__safe" aria-hidden="true">
                      <div className="studio-onscreen__safe-top" style={{ height: `${REEL_SAFE.top * 100}%` }}><span>Header</span></div>
                      <div className="studio-onscreen__safe-right" style={{ top: `${REEL_SAFE.top * 100}%`, bottom: `${REEL_SAFE.bottom * 100}%`, width: `${REEL_SAFE.right * 100}%` }}><span>Buttons</span></div>
                      <div className="studio-onscreen__safe-bottom" style={{ height: `${REEL_SAFE.bottom * 100}%` }}><span>Caption</span></div>
                    </div>
                  )}
                  {picked && picked.box_ids.map((id) => {
                    const box = draft.boxes.find((item) => item.id === id);
                    if (!box) return null;
                    return (
                      <div
                        key={`area-${id}`}
                        className="studio-onscreen__box"
                        data-box-id={id}
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.w * 100}%`,
                          height: `${box.h * 100}%`,
                          ["--box" as string]: colorOf(box),
                        }}
                      >
                        <span className="studio-onscreen__box-name">
                          {id === picked.box_ids[0] ? "Moves inside here" : "Also here"}
                        </span>
                        {HANDLES.map((handle) => (
                          <span
                            key={handle}
                            className={`studio-onscreen__handle studio-onscreen__handle--${handle}`}
                            data-handle={handle}
                            data-box-id={id}
                          />
                        ))}
                      </div>
                    );
                  })}
                  {lines.map(({ cap, index, box }) => {
                    if (editing !== index && active !== index && !lineOnAt(cap, time, duration)) return null;
                    const spot = cap.place?.[box.id] ?? { x: 0.5, y: 0.5 };
                    const typing = editing === index;
                    const look = bar ? "bar" : draft.look.background;
                    const words = (
                      <span
                        ref={typing ? editRef : undefined}
                        className={`studio-onscreen__type studio-onscreen__type--${look}`}
                        data-role="text"
                        data-line={index}
                        data-box-id={box.id}
                        data-style={draft.look.style}
                        data-lines={cap.lines || undefined}
                        data-active={active === index}
                        data-empty={!cap.text}
                        role={typing ? "textbox" : undefined}
                        aria-label={typing ? `On-screen line ${index + 1}` : `Line ${index + 1}: ${cap.text || "empty"}`}
                        contentEditable={typing ? "plaintext-only" : undefined}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onInput={typing ? (event) => {
                          const value = (event.currentTarget.textContent || "").slice(0, 120);
                          if (value !== event.currentTarget.textContent) event.currentTarget.textContent = value;
                          patchCaption(index, { text: value });
                        } : undefined}
                        onKeyDown={typing ? (event) => {
                          if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
                            event.preventDefault();
                            finishEditing();
                          }
                        } : undefined}
                        onBlur={typing ? () => finishEditing() : undefined}
                        style={bar
                          ? { top: `${(box.y + spot.y * box.h) * 100}%`, fontSize: `calc(4.2cqw * ${cap.size ?? 1})` }
                          : { ...seatStyle(spot.x, spot.y), fontSize: `calc(6.2cqw * ${cap.size ?? 1})` }}
                      >
                        {typing ? null : cap.text || "Tap to type"}
                      </span>
                    );
                    if (bar) return <span key={`line-${cap.id}-${index}`} className="studio-onscreen__barslot">{words}</span>;
                    return (
                      <div
                        key={`line-${cap.id}-${index}`}
                        className="studio-onscreen__slot"
                        style={{
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.w * 100}%`,
                          height: `${box.h * 100}%`,
                        }}
                      >
                        {words}
                      </div>
                    );
                  })}
                  {lines.length === 0 && (
                    <button
                      type="button"
                      className="studio-onscreen__empty"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={startLine}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">title</span>
                      Tap to add text
                    </button>
                  )}
                  {fitWarning && active !== null ? <p className="studio-onscreen__toast" role="status">{fitWarning}</p> : null}
                </div>
                {picked && pickedBox && editing === null && (
                  <label className="studio-onscreen__size" onPointerDown={(event) => event.stopPropagation()}>
                    <span>{Math.round((picked.size ?? 1) * 100)}%</span>
                    <input
                      type="range"
                      min={55}
                      max={160}
                      step={5}
                      aria-label="Text size"
                      value={Math.round((picked.size ?? 1) * 100)}
                      onChange={(event) => patchCaption(active!, { size: clampTextSize(Number(event.target.value) / 100) })}
                    />
                  </label>
                )}
              </div>

              <div className="studio-onscreen__timeline">
                <div className="studio-onscreen__transport">
                  <button
                    type="button"
                    className="studio-onscreen__playbtn"
                    aria-label={isPlaying ? "Pause" : "Play"}
                    disabled={!videoUrl}
                    onClick={togglePlay}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">{isPlaying ? "pause" : "play_arrow"}</span>
                  </button>
                  <span className="studio-onscreen__clock">{clockTenths(time)} <em>/ {clockTenths(duration)}</em></span>
                  <button type="button" className="studio-onscreen__addtext" onClick={startLine}>
                    <span className="material-symbols-rounded" aria-hidden="true">add</span>
                    Text
                  </button>
                </div>
                <div className="studio-onscreen__tracks">
                  <div
                    ref={rulerRef}
                    className="studio-onscreen__film"
                    data-testid="clip-scrubber"
                    aria-label="Scrub the clip"
                    onPointerDown={onRulerPointerDown}
                    onPointerMove={onRulerPointerMove}
                    onPointerUp={onRulerPointerUp}
                  >
                    {(frames.length ? frames : Array.from({ length: 10 }, () => poster)).map((src, i) => (
                      <span
                        key={i}
                        className="studio-onscreen__film-frame"
                        style={src ? { backgroundImage: `url(${src})` } : undefined}
                      />
                    ))}
                  </div>
                  {lines.map(({ cap, index, box }) => {
                    const span = trackWindow(cap.show, cap.hide, duration);
                    const left = (span.start / duration) * 100;
                    const width = Math.max(4, ((span.end - span.start) / duration) * 100);
                    return (
                      <div key={`lane-${cap.id}-${index}`} className="studio-onscreen__lane" data-testid="caption-track">
                        <div
                          className="studio-onscreen__cue"
                          data-active={active === index}
                          aria-label={`Line ${index + 1} on screen ${clockTenths(span.start)} to ${clockTenths(span.end)}`}
                          style={{ left: `${left}%`, width: `${width}%`, ["--box" as string]: colorOf(box) }}
                          onPointerDown={(event) => onLanePointerDown(event, index)}
                          onPointerMove={onLanePointerMove}
                          onPointerUp={onLanePointerUp}
                        >
                          <span className="studio-onscreen__trim" data-trim="start" aria-hidden="true" />
                          <span className="studio-onscreen__cue-text">
                            <span className="material-symbols-rounded" aria-hidden="true">title</span>
                            {cap.text || "Text"}
                          </span>
                          <span className="studio-onscreen__trim" data-trim="end" aria-hidden="true" />
                        </div>
                      </div>
                    );
                  })}
                  <span className="studio-onscreen__playhead" style={{ left: `${pct}%` }} aria-hidden="true" />
                </div>
              </div>

              <div className="studio-onscreen__side">
              {setupNote ? <p className="studio-onscreen__hint studio-onscreen__note" role="status">{setupNote}</p> : null}
              {!picked && (
                <p className="studio-onscreen__side-hint">Tap the words on the video to edit them. Drag a clip on the timeline to set when they show.</p>
              )}

              {picked && pickedBox ? (
                <div className="studio-onscreen__textbar" role="group" aria-label="Line tools">
                  <div className="studio-onscreen__swatches" role="group" aria-label="Look">
                    {LOOKS.map((look) => {
                      const fill = look.key === "classic" || look.key === "strong" ? draft.look.background : look.key;
                      const kind = look.key === "caption-bar" ? "bar" : fill;
                      return (
                        <button
                          key={look.key}
                          type="button"
                          className="studio-onscreen__swatch"
                          aria-label={look.name}
                          aria-pressed={lookOn(look.key)}
                          data-on={lookOn(look.key)}
                          onClick={() => setLook(look.key)}
                        >
                          <span className="studio-onscreen__swatch-frame">
                            <span
                              className={`studio-onscreen__type studio-onscreen__type--${kind}`}
                              data-style={look.key === "strong" ? "strong" : look.key === "classic" ? "classic" : draft.look.style}
                            >
                              Aa
                            </span>
                          </span>
                          <span className="studio-onscreen__swatch-name">{look.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="studio-onscreen__actions">
                    <button type="button" className="studio-onscreen__act" onClick={() => setEditing(active)}>
                      <span className="material-symbols-rounded" aria-hidden="true">keyboard</span>Edit
                    </button>
                    <button type="button" className="studio-onscreen__act" data-on={sheet === "fit"} onClick={() => setSheet(sheet === "fit" ? null : "fit")}>
                      <span className="material-symbols-rounded" aria-hidden="true">tune</span>Fit
                    </button>
                    <button type="button" className="studio-onscreen__act" onClick={() => deleteLine(active!)}>
                      <span className="material-symbols-rounded" aria-hidden="true">delete</span>Delete
                    </button>
                    <button type="button" className="studio-onscreen__act studio-onscreen__act--done" onClick={() => select(null)}>
                      <span className="material-symbols-rounded" aria-hidden="true">check</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="studio-onscreen__dock" role="group" aria-label="Editor tools">
                  {(
                    [
                      ["text", "title", "Text"],
                      ["sound", "music_note", "Sound"],
                      ["setups", "bookmark", "Setups"],
                      ["ratio", "aspect_ratio", "Ratio"],
                    ] as const
                  ).map(([id, icon, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="studio-onscreen__tool"
                      data-on={sheet === id}
                      aria-pressed={sheet === id}
                      onClick={() => {
                        if (id === "text") {
                          startLine();
                          return;
                        }
                        setSheet(sheet === id ? null : id);
                      }}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
                      {label}
                      {id === "sound" && audios.length > 0 ? <i className="studio-onscreen__badge">{audios.length}</i> : null}
                    </button>
                  ))}
                </div>
              )}

              {sheet && (
                <div className="studio-onscreen__drawer" role="dialog" aria-label={sheet === "fit" ? "Fit" : sheet === "sound" ? "Sound" : sheet === "setups" ? "Setups" : "Ratio"}>
                  <div className="studio-onscreen__drawer-head">
                    <strong>{sheet === "fit" ? "Fit" : sheet === "sound" ? "Sound" : sheet === "setups" ? "Saved setups" : "Frame"}</strong>
                    <button type="button" className="studio-onscreen__drawer-close" aria-label="Close tool" onClick={() => setSheet(null)}>
                      <span className="material-symbols-rounded" aria-hidden="true">keyboard_arrow_down</span>
                    </button>
                  </div>
                  {sheet === "fit" && picked && pickedBox && active !== null && (
                    <>
                      <div className="studio-onscreen__fit" role="group" aria-label="Line count">
                        <span className="studio-onscreen__fit-label">Lines</span>
                        <button type="button" className="studio-onscreen__look" data-on={picked.lines === 1 || picked.lines === "both"} aria-pressed={picked.lines === 1 || picked.lines === "both"} onClick={() => toggleLine(active, 1)}>1 line</button>
                        <button type="button" className="studio-onscreen__look" data-on={picked.lines === 2 || picked.lines === "both"} aria-pressed={picked.lines === 2 || picked.lines === "both"} onClick={() => toggleLine(active, 2)}>2 lines</button>
                      </div>
                      <div className="studio-onscreen__fit" role="group" aria-label="Spots">
                        <span className="studio-onscreen__fit-label">Spots</span>
                        {picked.box_ids.length < 4 && draft.boxes.length < 4 && (
                          <button type="button" className="studio-onscreen__look" onClick={() => addSpot(active)}>Add a spot</button>
                        )}
                        {picked.box_ids.slice(1).map((id) => (
                          <button key={id} type="button" className="studio-onscreen__look" onClick={() => removeSpot(active, id)}>
                            Remove {BOX_COLORS.find((color) => color.id === id)?.label || id}
                          </button>
                        ))}
                      </div>
                      <div className="studio-onscreen__fit" role="group" aria-label="Seats toggle">
                        <span className="studio-onscreen__fit-label">Seats</span>
                        <button
                          type="button"
                          className="studio-onscreen__look"
                          data-on={!!draft.chooseSeats}
                          aria-pressed={!!draft.chooseSeats}
                          onClick={() => onChange({ ...draft, chooseSeats: !draft.chooseSeats })}
                        >
                          Choose seats
                        </button>
                      </div>
                      {draft.chooseSeats && (
                        <div className="studio-onscreen__seats" role="group" aria-label="Seats">
                          {(bar ? TEXT_SEATS.filter((seat) => seat.id === "tc" || seat.id === "mc" || seat.id === "bc") : TEXT_SEATS).map((seat) => {
                            const on = !!pickedBox.seats?.includes(seat.id);
                            return (
                              <button
                                key={seat.id}
                                type="button"
                                className="studio-onscreen__look"
                                data-on={on}
                                aria-pressed={on}
                                onClick={() => toggleSeat(seat.id)}
                              >
                                {bar ? (seat.id === "tc" ? "Top" : seat.id === "mc" ? "Middle" : "Bottom") : seat.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  {sheet === "ratio" && (
                    <div className="studio-onscreen__frames" role="group" aria-label="Frame shape">
                      <button
                        type="button"
                        className="studio-onscreen__clip"
                        data-on={framePreset === null}
                        onClick={() => setFramePreset(null)}
                      >
                        Source
                      </button>
                      {FRAME_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="studio-onscreen__clip"
                          data-on={framePreset === preset.id}
                          onClick={() => setFramePreset(preset.id)}
                        >
                          {preset.id}
                        </button>
                      ))}
                    </div>
                  )}
                  {sheet === "sound" && (
                    <>
                      <p className="studio-onscreen__hint">Up to 4 sounds take turns across variants. A video keeps only its sound.</p>
                      <div className="studio-onscreen__looks" role="listbox" aria-label="Sounds">
                        {audios.map((audio) => (
                          <button
                            key={audio.id}
                            type="button"
                            role="option"
                            aria-selected={activeSound?.id === audio.id}
                            className="studio-onscreen__look"
                            data-on={activeSound?.id === audio.id}
                            onClick={() => setSelectedSound(audio.id)}
                          >
                            {audio.name}
                          </button>
                        ))}
                        {audios.length < MAX_SOUNDS && (
                          <button type="button" className="studio-onscreen__look" onClick={() => soundInputRef.current?.click()}>
                            Add a sound
                          </button>
                        )}
                      </div>
                      {activeSound ? (
                        <div className="studio-onscreen__sound" data-testid="studio-onscreen-sound">
                          <div className="studio-onscreen__sound-row">
                            <button type="button" className="studio-onscreen__look" data-on={playing === activeSound.id} onClick={() => playSound(activeSound)}>
                              {playing === activeSound.id ? "Stop" : "Play"}
                            </button>
                            <span className="studio-onscreen__sound-name">{activeSound.name}</span>
                            <button type="button" className="studio-onscreen__look" onClick={() => removeSound(activeSound.id)} aria-label={`Remove ${activeSound.name}`}>
                              Remove
                            </button>
                          </div>
                          <label className="studio-onscreen__volume">
                            Volume {Math.round(activeSound.volume * 100)}%
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(activeSound.volume * 100)}
                              aria-label={`${activeSound.name} volume`}
                              onChange={(event) => patchAudio(activeSound.id, { volume: Number(event.target.value) / 100 })}
                            />
                          </label>
                          <div className="studio-onscreen__fit" role="group" aria-label={`${activeSound.name} mode`}>
                            <button type="button" className="studio-onscreen__look" data-on={activeSound.mode !== "replace"} onClick={() => setSoundMode(activeSound, "under")}>Under the voice</button>
                            <button type="button" className="studio-onscreen__look" data-on={activeSound.mode === "replace"} onClick={() => setSoundMode(activeSound, "replace")}>Replace</button>
                            <label className="studio-onscreen__start">
                              Start
                              <input
                                type="number"
                                min={0}
                                max={30}
                                step={1}
                                value={activeSound.start}
                                aria-label={`${activeSound.name} start`}
                                style={{ fontSize: 16 }}
                                onChange={(event) => patchAudio(activeSound.id, { start: Math.min(30, Math.max(0, Number(event.target.value) || 0)) })}
                              />
                            </label>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  {sheet === "setups" && (
                    <>
                      <p className="studio-onscreen__hint">Save this edit. Check up to 5 to print.</p>
                      <div className="studio-onscreen__sound-row">
                        <input
                          className="studio-onscreen__name"
                          value={templateName}
                          maxLength={48}
                          placeholder="Name this setup"
                          aria-label="Setup name"
                          style={{ fontSize: 16 }}
                          onChange={(event) => setTemplateName(event.target.value)}
                        />
                        <button type="button" className="studio-onscreen__look" onClick={() => void saveSetup()}>Save</button>
                      </div>
                      <div className="studio-onscreen__cards">
                        {templates.map((row) => {
                          const on = pickedPrints.includes(row.id);
                          return (
                            <div key={row.id} className="studio-onscreen__card" data-testid="studio-onscreen-setup">
                              <span className="studio-onscreen__sound-name">{row.name}</span>
                              <button
                                type="button"
                                className="studio-onscreen__look"
                                data-on={on}
                                aria-pressed={on}
                                onClick={() => togglePrint(row.id)}
                              >
                                {on ? "Printing" : "Print"}
                              </button>
                              <button type="button" className="studio-onscreen__look" onClick={() => onChange(draftFromSaved(row.project as OnScreenProject))}>
                                Use
                              </button>
                              <button type="button" className="studio-onscreen__look" aria-label={`Delete ${row.name}`} onClick={() => void removeSetup(row.id)}>
                                Delete
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {pickedPrints.length > 0 && (
                        <p className="studio-onscreen__hint" data-testid="print-plan">
                          Printing {pickedPrints.length} setups, {printPlan(perVideo, pickedPrints.length).each} variants each ({printPlan(perVideo, pickedPrints.length).total} total).
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              </div>
              <input
                ref={soundInputRef}
                className="studio-onscreen__file"
                type="file"
                accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                multiple
                aria-label="Add a sound"
                onChange={(event) => {
                  addSounds(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
