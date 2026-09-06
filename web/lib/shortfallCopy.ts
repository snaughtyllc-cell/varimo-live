import { SourceOut } from "./types";
import { jobIsLive } from "./queue";

/** Gallery shortfall banner copy. Never send operators to Diagnostics. */
export function shortfallCopy(source: SourceOut): string | null {
  if (source.shortfall <= 0) return null;
  const n = source.shortfall;
  const plural = n === 1 ? "" : "s";
  if (jobIsLive(source.job_state) || source.in_flight) {
    return `Still rendering — ${source.delivered}/${source.requested} delivered so far.`;
  }
  if ((source.failed ?? 0) > 0) {
    return `${n} variant${plural} fell short after auto-retry — Regenerate this pack to fill the gap.`;
  }
  return `${n} variant${plural} missing / not delivered — Regenerate to fill the gap.`;
}
