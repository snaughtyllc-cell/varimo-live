import { VariantEvent, Quality, PlatformResult } from "./types";
import { variantUrl } from "./api";

export type InFlightState = "rendering" | "checking" | "looking" | "rerolling" | "uniqueness" | "escalating";

export interface InFlight {
  index: number;
  state: InFlightState;
  attempt: number;
  max_attempts: number;
}
export interface VariantTile {
  index: number; filename: string; status: string; quality: Quality; file_url: string;
  uniqueness?: number | null; uniqueness_status?: string | null;
  uniqueness_target?: number | null; escalated?: boolean;
  platform_result?: PlatformResult | null;
  look_status?: string | null;
  look_mae?: number | null;
  look_src_url?: string | null;
  look_var_url?: string | null;
}
export interface SourceProgress {
  source_id: string; filename: string; requested: number; delivered: number; done: number;
  inFlight?: InFlight;
  inFlights: Record<number, InFlight>;
  lookPreview?: {
    index: number;
    src: string;
    var: string;
    status: string | null;
    mae: number | null;
  };
  variants: VariantTile[];
}
export interface RunProgress {
  bySource: Record<string, SourceProgress>;
  complete: boolean;
  failed?: string | null;
  waitPhase?: string | null;
}

export function initRun(sources: { source_id: string; filename: string; requested: number }[]): RunProgress {
  const bySource: Record<string, SourceProgress> = {};
  for (const s of sources) bySource[s.source_id] = { ...s, delivered: 0, done: 0, variants: [], inFlights: {} };
  return { bySource, complete: false, failed: null, waitPhase: null };
}

function dropFlight(next: SourceProgress, index: number): void {
  const { [index]: _dropped, ...rest } = next.inFlights || {};
  next.inFlights = rest;
  if (next.inFlight?.index === index) {
    const remaining = Object.values(rest);
    next.inFlight = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
  }
}

function lookStillUrl(
  sourceId: string,
  name?: string | null,
  url?: string | null,
): string {
  if (url) return url;
  if (!name) return "";
  return `/api/look/${encodeURIComponent(sourceId)}/${encodeURIComponent(name)}`;
}

export function reduceEvent(run: RunProgress, ev: VariantEvent | { state: "job-done" }): RunProgress {
  if (ev.state === "job-done") {
    const bySource = Object.fromEntries(
      Object.entries(run.bySource).map(([id, s]) => [
        id,
        { ...s, inFlight: undefined, inFlights: {} },
      ]),
    );
    return { ...run, complete: true, failed: run.failed ?? null, bySource };
  }
  const e = ev as VariantEvent;
  const prev = run.bySource[e.source_id];
  if (!prev) return run; // unknown source (shouldn't happen — seeded from CreateJobResponse)
  const next: SourceProgress = { ...prev, variants: prev.variants, inFlights: { ...(prev.inFlights || {}) } };
  if (
    e.state === "rendering" || e.state === "checking" || e.state === "looking" ||
    e.state === "rerolling" || e.state === "uniqueness" || e.state === "escalating"
  ) {
    const flight: InFlight = { index: e.index, state: e.state, attempt: e.attempt, max_attempts: e.max_attempts };
    next.inFlight = flight;
    next.inFlights[e.index] = flight;
    if (e.state === "looking" && (e.look_src || e.look_var || e.look_src_url || e.look_var_url)) {
      const sid = e.source_id;
      next.lookPreview = {
        index: e.index,
        src: lookStillUrl(sid, e.look_src, e.look_src_url),
        var: lookStillUrl(sid, e.look_var, e.look_var_url),
        status: e.look_status ?? null,
        mae: e.look_mae ?? null,
      };
    }
  } else if (e.state === "done") {
    const existing = prev.variants.find((v) => v.index === e.index);
    if (existing) {
      // Idempotent: the backend replays the full event log on every (re)connect and
      // EventSource auto-reconnects on network loss. A replayed `done` must not
      // double-append or double-count — only ensure inFlight is cleared.
      // A later polled `done` (with uniqueness/escalated/platform_result) can still
      // enrich a tile that first arrived via a plain SSE `done`.
      next.variants = prev.variants.map((v) =>
        v.index === e.index
          ? {
              ...v,
              uniqueness: e.uniqueness ?? v.uniqueness,
              uniqueness_status: e.uniqueness_status ?? v.uniqueness_status,
              uniqueness_target: e.uniqueness_target ?? v.uniqueness_target,
              escalated: e.escalated ?? v.escalated,
              platform_result: e.platform_result ?? v.platform_result,
              look_status: e.look_status ?? v.look_status,
              look_mae: e.look_mae ?? v.look_mae,
              look_src_url: lookStillUrl(e.source_id, e.look_src, e.look_src_url) || v.look_src_url,
              look_var_url: lookStillUrl(e.source_id, e.look_var, e.look_var_url) || v.look_var_url,
            }
          : v,
      );
      dropFlight(next, e.index);
    } else {
      next.variants = [...prev.variants, {
        index: e.index, filename: e.filename!, status: e.status!, quality: e.quality!,
        file_url: variantUrl(e.source_id, e.filename!),
        uniqueness: e.uniqueness ?? null,
        uniqueness_status: e.uniqueness_status ?? null,
        uniqueness_target: e.uniqueness_target ?? null,
        escalated: e.escalated ?? false,
        platform_result: e.platform_result ?? null,
        look_status: e.look_status ?? null,
        look_mae: e.look_mae ?? null,
        look_src_url: lookStillUrl(e.source_id, e.look_src, e.look_src_url) || null,
        look_var_url: lookStillUrl(e.source_id, e.look_var, e.look_var_url) || null,
      }];
      next.done = prev.done + 1;
      if (e.status === "ok") next.delivered = prev.delivered + 1;
      dropFlight(next, e.index);
    }
  }
  return { ...run, bySource: { ...run.bySource, [e.source_id]: next } };
}

export function runDeliveredNone(progress: RunProgress): boolean {
  if (!progress.complete) return false;
  const sources = Object.values(progress.bySource);
  if (sources.length === 0) return true;
  return sources.every((s) => s.delivered === 0);
}

/** True once a copy is encoding or already delivered — not still waiting on the GPU. */
export function runHasStarted(progress: RunProgress): boolean {
  return Object.values(progress.bySource).some(
    (s) =>
      s.delivered > 0
      || s.done > 0
      || Boolean(s.inFlight)
      || Object.keys(s.inFlights || {}).length > 0,
  );
}
