/** Studio variant-count defaults and Fast-path helper copy. */

export const DEFAULT_PER_VIDEO = 20;
/** Stepper ceiling — usual Fast pack is ~20; leave room to tap up. */
export const MAX_PER_VIDEO = 40;
/** Suggested count when someone is timing a first Generate. */
export const SPEED_TEST_PER_VIDEO = 3;
/** Phone/desktop chips — numbers only so 20 is not framed as the required pack. */
export const VARIANT_COUNT_PRESETS = [SPEED_TEST_PER_VIDEO, 10, 20] as const;

export function variantPresetLabel(count: number): string {
  return String(count);
}

export function variantStepperHint(qualityMode: "fast" | "hq"): string | null {
  if (qualityMode !== "fast") return null;
  return "Usual pack is 20 on the GPU. Tap − to 3 for a speed test on Studio (no GPU wait).";
}

export function generatePackLabel(fileCount: number, perVideo: number): string {
  if (fileCount <= 0) return `${perVideo} variants each`;
  if (fileCount === 1) return `1 clip → ${perVideo} variants`;
  return `${fileCount} clips → ${fileCount * perVideo} variants`;
}
