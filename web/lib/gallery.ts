import { uniquenessPassPct } from "./prepareCopy";
import { jobIsLive } from "./queue";
import { SourceOut } from "./types";

export function filterSources(sources: SourceOut[], mode: "all" | "shortfall"): SourceOut[] {
  return mode === "shortfall"
    ? sources.filter(s => s.shortfall > 0 || s.copy_status === "missing")
    : sources;
}

export function zipEmptyCopy(): string {
  return "Those videos aren't available for download yet. Try again in a moment, or regenerate.";
}

export function copyMissingCopy(): string {
  return "Processing finished, but the download package isn't ready. Retry delivery, or regenerate if that still fails.";
}

export function copyLandingCopy(): string {
  return "Downloads are still landing…";
}

export function removePackCopy(running: boolean): string {
  return running
    ? "This pack is still generating. Removing it stops that Generate for everyone on this Studio URL. Job files and download links are removed."
    : "Remove this pack from Gallery? Job files and download links are removed. Drive uploads are not touched.";
}

/** "Expires Sep 5, 3:42 PM" — null when the job has no retention clock. */
export function expiresLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= now.getTime()) return "Downloads expired";
  return `Expires ${d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function filesReadyCount(source: SourceOut): number {
  return source.files_ready ?? source.delivered;
}

export function deliveryComplete(source: SourceOut): boolean {
  if (source.copy_status === "missing" || source.copy_status === "copying") return false;
  return filesReadyCount(source) >= source.requested && source.shortfall === 0;
}

export function isFileReady(variant: { file_ready?: boolean }): boolean {
  return variant.file_ready !== false;
}

export function sortSources(sources: SourceOut[], by: "newest"): SourceOut[] {
  if (by !== "newest") return sources;
  return [...sources].sort((a, b) => {
    const ta = a.created_utc ?? "";
    const tb = b.created_utc ?? "";
    if (ta !== tb) return tb.localeCompare(ta);
    return 0;
  });
}

/** `?v=<source_id>:<variant.index>` from the Gallery address bar. */
export function parseGalleryVariantQuery(
  raw: string | null | undefined,
): { sourceId: string; index: number } | null {
  if (!raw) return null;
  const colonIdx = raw.lastIndexOf(":");
  if (colonIdx <= 0) return null;
  const sourceId = raw.slice(0, colonIdx);
  const parsed = Number.parseInt(raw.slice(colonIdx + 1), 10);
  if (!sourceId || Number.isNaN(parsed)) return null;
  return { sourceId, index: parsed };
}

export function gallerySearchPath(sourceId?: string | null, index?: number | null): string {
  if (!sourceId || index == null) return "/gallery";
  return `/gallery?v=${sourceId}:${index}`;
}

/**
 * Update the address bar without a Next.js navigation.
 * `router.push` remounts Gallery (Suspense flash + dialog replay = "glitching").
 */
export function pushGallerySearch(path: string): void {
  if (typeof window === "undefined") return;
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState(null, "", path);
}

/** Pack-average originality, 0–100. Null when no variant has scored yet. */
export function avgOriginalityPct(source: SourceOut): number | null {
  const values = source.variants
    .map((v) => v.uniqueness)
    .filter((u): u is number => typeof u === "number");
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100);
}

/**
 * Originality badge color for tiles drawn on a dark thumbnail.
 * Mint at the vs-source pass (~38%). 65% is typical medium, not a gate.
 */
export function tileOriginalityColor(pct: number | null): string {
  if (pct == null) return "var(--color-muted2)";
  return pct >= uniquenessPassPct() ? "var(--color-mint)" : "var(--color-amber2)";
}

/** Originality label color for a pack row on a white surface (violet / amber). */
export function packOriginalityColor(pct: number | null): string {
  if (pct == null) return "var(--color-muted2)";
  return pct < uniquenessPassPct() ? "var(--color-amber)" : "var(--color-violet)";
}

/** Poll Gallery while a pack is still generating so 0/20 rows do not look dead. */
export function galleryRefreshMs(sources: SourceOut[] | undefined | null): number {
  if (!sources?.length) return 0;
  return sources.some(
    (source) =>
      jobIsLive(source.job_state) ||
      !!source.in_flight ||
      source.copy_status === "missing",
  )
    ? 4000
    : 0;
}

/** Finished packs whose mp4s never landed — Retry delivery once per source. */
export function missingCopySourceIds(
  sources: SourceOut[] | undefined | null,
  alreadyTried?: Set<string>,
): string[] {
  if (!sources?.length) return [];
  const tried = alreadyTried ?? new Set<string>();
  return sources
    .filter((source) => (
      source.copy_status === "missing"
      && !jobIsLive(source.job_state)
      && !source.in_flight
      && !tried.has(source.source_id)
    ))
    .map((source) => source.source_id);
}

/** "Generating · 0/20 · today" / "20 variants · today" — pack-list row meta line. */
export function packMetaLabel(source: SourceOut, now: Date = new Date()): string {
  const delivered = filesReadyCount(source);
  const when = relativeDayLabel(source.created_utc, now);
  const live = jobIsLive(source.job_state) || !!source.in_flight;
  const parts: string[] = [];
  if (live) {
    parts.push("Generating");
    parts.push(`${delivered}/${source.requested}`);
  } else {
    const n = source.variants.length;
    parts.push(`${n} variant${n === 1 ? "" : "s"}`);
    if (source.requested > 0 && delivered < source.requested) {
      if (n === 0) parts[0] = "Didn't finish";
      parts.push(`${delivered}/${source.requested}`);
    }
  }
  if (when) parts.push(when);
  return parts.join(" · ");
}

function relativeDayLabel(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
