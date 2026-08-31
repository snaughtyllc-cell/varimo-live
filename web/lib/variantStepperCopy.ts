/** Studio variant-count defaults. Keep helper copy off the stepper — no GPU tips. */

export const DEFAULT_PER_VIDEO = 8;
/** Stepper ceiling — leave room to tap up from the default 8. */
export const MAX_PER_VIDEO = 40;

export function variantStepperHint(_qualityMode: "fast" | "hq"): string | null {
  return null;
}

export function generatePackLabel(_fileCount: number, perVideo: number): string {
  return `${perVideo} variants each`;
}
