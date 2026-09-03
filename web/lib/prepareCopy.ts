import { pct01 } from "./format";
import type { QualityHead } from "./types";

export const PREPARING_JOB_ID = "preparing";

export function isPreparingJob(jobId: string | null | undefined): boolean {
  return jobId === PREPARING_JOB_ID;
}

export function preparingHeadline(): string {
  return "Preparing generation";
}

export function preparingSubcopy(): string {
  return "Request received. The processing environment can take 20–30 seconds to start — tiles update as soon as encoding begins.";
}

export function preparingSlotLabel(): string {
  return "starting";
}

export function captionToggleLabel(): string {
  return "Write captions for these copies";
}

export function captionToggleHint(): string {
  return (
    "One box per source clip, with a thumbnail. Claude writes a unique take " +
    "for each copy — edit in Gallery before you send."
  );
}

export function captionPromptLabel(): string {
  return "Caption for this clip";
}

export function captionPromptPlaceholder(): string {
  return "The caption you want on copies of this clip";
}

export function captionPromptLabelForSource(index: number, total: number): string {
  return total > 1 ? `Caption for source ${index + 1} of ${total}` : captionPromptLabel();
}

export function sourceCaptionEyebrow(index: number, total: number): string {
  return total > 1 ? `Source ${index + 1} of ${total}` : "Source";
}

export function captionNeedSourcesCopy(): string {
  return "Add videos first — each clip gets its own thumbnail and caption box.";
}

export function alignCaptionPrompts(prev: string[], count: number): string[] {
  const n = Math.max(0, count);
  const next = prev.slice(0, n);
  while (next.length < n) next.push("");
  return next;
}

const INTERNAL_INDEX_RE = /^(?:copy|take)\s+\d+\s+of\s+\d+\s*(?:[—–-].*)?$/i;

export function stripInternalIndexLines(text: string | null | undefined): string {
  return (text || "")
    .split(/\r?\n/)
    .filter((line) => !INTERNAL_INDEX_RE.test(line.trim()))
    .join("\n")
    .trim();
}

export function captionPreviewLabel(): string {
  return "Caption";
}

export function captionEmptyCopy(): string {
  return "No caption on this copy yet.";
}

export function captionSaveLabel(): string {
  return "Save caption";
}

export function captionCopyLabel(): string {
  return "Copy caption";
}

export function captionCopiedLabel(): string {
  return "Copied";
}

export function captionCopyBlockedCopy(): string {
  return "Clipboard blocked — select the caption and copy it.";
}

export function captionStatusHint(): string {
  return (
    "Edit here before Send to Drive or a drop. After it is posted, pass / duplicate " +
    "is for this video — not the caption. If you change the caption on Instagram, " +
    "this box will not update; use the post link to find the right copy."
  );
}

export function packOptionsLabel(): string {
  return "Options";
}

export function rewriteCaptionsLabel(): string {
  return "Rewrite captions";
}

export function rewriteCaptionsBusy(): string {
  return "Rewriting…";
}

export function rewriteCaptionsHint(): string {
  return "Writes a new unique take for every copy in this pack. Videos stay the same.";
}

export function rewriteCaptionsSeedLabel(): string {
  return "Seed caption";
}

export function packCaptionSeed(source: {
  caption_prompt?: string | null;
  filename?: string;
  variants?: Array<{ caption?: string | null }>;
}): string {
  const stored = (source.caption_prompt || "").trim();
  if (stored) return stored;
  for (const variant of source.variants || []) {
    const caption = stripInternalIndexLines(variant.caption);
    if (caption) return caption;
  }
  return "";
}

export function uniquenessCustomerLabel(): string {
  return "Originality";
}

export function uniquenessCoverageSubcopy(): string {
  return "Pixel difference vs the original (3 frames). Not a platform check.";
}

export function uniquenessGalleryBadgeTitle(pct: number): string {
  return `Originality ${pct}% is pixel SSIM vs the original (3 frames). Not a platform pass.`;
}

export type UniquenessCoverageKind = "pixel" | "visual" | "audio";
export type UniquenessCoverageState = "scored" | "not_scored";

export interface UniquenessCoverageChip {
  kind: UniquenessCoverageKind;
  label: string;
  state: UniquenessCoverageState;
  text: string;
  title: string;
}

const COVERAGE_LABEL: Record<UniquenessCoverageKind, string> = {
  pixel: "Pixel",
  visual: "Visual copy-id",
  audio: "Audio",
};

function headAvailable(
  heads: Record<string, QualityHead | null | undefined> | null | undefined,
  kind: "visual" | "audio",
): boolean {
  return heads?.[kind]?.available === true;
}

function headUniqueness(
  heads: Record<string, QualityHead | null | undefined> | null | undefined,
  kind: "visual" | "audio",
): number | null {
  const value = heads?.[kind]?.uniqueness;
  return typeof value === "number" ? value : null;
}

function coverageChipTitle(kind: UniquenessCoverageKind, state: UniquenessCoverageState): string {
  if (kind === "pixel") {
    return state === "scored"
      ? "Pixel SSIM vs the original at 25/50/75. This is the Originality percent. Not a platform check."
      : "Pixel SSIM was not scored on this copy. Not a platform check.";
  }
  if (kind === "visual") {
    return state === "scored"
      ? "Visual copy-id ran on this copy. Local tuning dial, not a platform check."
      : "Visual copy-id is not scored yet. Not a platform check.";
  }
  return state === "scored"
    ? "Audio fingerprint ran on this copy. Local tuning dial, not a platform check."
    : "Audio fingerprint is not scored yet. Not a platform check.";
}

function coverageChipText(
  kind: UniquenessCoverageKind,
  state: UniquenessCoverageState,
  uniqueness: number | null,
): string {
  const label = COVERAGE_LABEL[kind];
  if (state === "not_scored") return `${label} · not scored`;
  if (kind !== "pixel" && uniqueness != null) return `${label} · ${pct01(uniqueness)}%`;
  return `${label} · scored`;
}

export function uniquenessCoverageChips(
  uniqueness?: number | null,
  heads?: Record<string, QualityHead | null | undefined> | null,
): UniquenessCoverageChip[] {
  const kinds: UniquenessCoverageKind[] = ["pixel", "visual", "audio"];
  return kinds.map((kind) => {
    const state: UniquenessCoverageState =
      kind === "pixel"
        ? uniqueness != null
          ? "scored"
          : "not_scored"
        : headAvailable(heads, kind)
          ? "scored"
          : "not_scored";
    const scoredUniqueness =
      kind === "pixel" ? uniqueness ?? null : headUniqueness(heads, kind);
    return {
      kind,
      label: COVERAGE_LABEL[kind],
      state,
      text: coverageChipText(kind, state, scoredUniqueness),
      title: coverageChipTitle(kind, state),
    };
  });
}

export function captionSnippet(text: string | null | undefined, max = 80): string {
  const one = stripInternalIndexLines(text).replace(/\s+/g, " ").trim();
  if (!one) return "";
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
