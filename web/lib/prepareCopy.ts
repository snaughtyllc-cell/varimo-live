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
  return "Opens a box. Claude uses what you write for each copy — preview in Gallery.";
}

export function captionPromptLabel(): string {
  return "Caption for these copies";
}

export function captionPromptPlaceholder(): string {
  return "The caption you want on these copies";
}

export function captionPreviewLabel(): string {
  return "Caption";
}

export function captionEmptyCopy(): string {
  return "No caption on this copy yet.";
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
  const one = (text || "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
