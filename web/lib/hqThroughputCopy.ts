/** When HQ × a full batch is a wall-clock trap, not a GPU-price problem. */

export const HQ_HERO_COUNT = 3;
export const HQ_BATCH_WARN_AT = 6;

export function hqBatchHint(qualityMode: "fast" | "hq", totalVariants: number): string | null {
  if (qualityMode !== "hq") return null;
  if (totalVariants >= HQ_BATCH_WARN_AT) {
    return (
      `${totalVariants} HQ variants run one after another on one GPU. ` +
      `The usual ~20 should stay Fast. HQ is for 1–${HQ_HERO_COUNT} hero takes. ` +
      `A ~$2/hr 4090-class card speeds the AI step; it does not 20× the batch. ` +
      `RunPod currently kills a job at 25 minutes.`
    );
  }
  return (
    `HQ upscales every frame, then quality-checks — often several minutes per variant, ` +
    `one at a time. A faster GPU (4090-class, ~$1–2/hr) helps; 20 HQ still will not feel instant.`
  );
}
