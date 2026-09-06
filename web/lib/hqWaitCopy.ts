/** Studio copy while HQ (Phase 8) sits on v01 with no thumb. */

export type QualityMode = "fast" | "hq";
export type PrepMode = "none" | "hq";
export type InFlightVerb =
  | "rendering"
  | "checking"
  | "looking"
  | "rerolling"
  | "uniqueness"
  | "escalating"
  | "waiting";

export const HQ_RENDERING_HINT =
  "HQ upscales every frame — the first variant often takes several minutes with no thumb. That is not a hang.";

export function inFlightRenderingLabel(
  index: number,
  qualityMode: QualityMode = "fast",
): string {
  const idx = String(index).padStart(2, "0");
  if (qualityMode === "hq") {
    return `● v${idx} HQ upscaling…`;
  }
  return `● v${idx} rendering…`;
}

export function inFlightLookingLabel(index: number): string {
  return `● v${String(index).padStart(2, "0")} looking…`;
}

export function inFlightSlotLabel(
  state: InFlightVerb,
  qualityMode: QualityMode = "fast",
  attempt = 0,
  maxAttempts = 0,
): string {
  if (state === "rerolling") return `↻ ${attempt}/${maxAttempts}`;
  if (state === "rendering" && qualityMode === "hq") return "HQ";
  if (state === "checking") return "check";
  if (state === "looking") return "look";
  if (state === "uniqueness") return "unique";
  if (state === "escalating") return "escalate";
  if (state === "waiting") return "queued";
  return "render";
}

export function inFlightSummaryLine(
  flights: { index: number; state: string; attempt?: number; max_attempts?: number }[],
  qualityMode: QualityMode = "fast",
): string | null {
  if (flights.length === 0) return null;
  if (flights.length === 1) {
    const f = flights[0];
    const idx = String(f.index).padStart(2, "0");
    if (f.state === "rendering") return inFlightRenderingLabel(f.index, qualityMode);
    if (f.state === "checking") return `● v${idx} checking…`;
    if (f.state === "looking") return inFlightLookingLabel(f.index);
    if (f.state === "rerolling") return `↻ v${idx} re-rolling ${f.attempt}/${f.max_attempts}`;
    if (f.state === "uniqueness") return `⟡ v${idx} checking uniqueness…`;
    if (f.state === "escalating") return `⚡ v${idx} escalating strength…`;
  }
  const order = ["rendering", "checking", "looking", "uniqueness", "escalating", "rerolling"] as const;
  const counts = new Map<string, number>();
  for (const f of flights) counts.set(f.state, (counts.get(f.state) || 0) + 1);
  const word = (state: string, n: number): string => {
    if (state === "rendering") return qualityMode === "hq" ? "HQ upscaling" : "rendering";
    if (state === "checking") return n === 1 ? "checking" : "checking";
    if (state === "looking") return "looking";
    if (state === "uniqueness") return "uniqueness";
    if (state === "escalating") return "escalating";
    if (state === "rerolling") return "re-rolling";
    return state;
  };
  return order
    .filter((state) => counts.get(state))
    .map((state) => `${counts.get(state)} ${word(state, counts.get(state) || 0)}`)
    .join(" · ");
}

export function reconstructFirstHeadline(): string {
  return "Reconstructing first…";
}

export function reconstructFirstSubcopy(): string {
  return (
    "One HQ GPU pass rebuilds the pixels. Fast variants start after that — " +
    "first minutes have no Fast thumbs. That is not a hang."
  );
}

export function liveRunSubcopy(
  qualityMode: QualityMode = "fast",
  prepMode: PrepMode = "none",
): string {
  if (prepMode === "hq") {
    return (
      "Reconstruct first: one HQ GPU pass, then Fast variants. " +
      "The first minutes have no tiles — that is not a hang. " +
      "Gallery stays empty until a Fast variant finishes."
    );
  }
  if (qualityMode === "hq") {
    return `${HQ_RENDERING_HINT} Gallery stays empty until a variant finishes.`;
  }
  return (
    "This is one encode per variant (default 20 for one clip). Every copy gets a " +
    "tile as soon as Generate starts. Live status updates every second. Stay here " +
    "until tiles fill in; Gallery stays empty until a variant finishes."
  );
}
