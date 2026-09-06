import type { InFlight, SourceProgress, VariantTile } from "./progress";

export type LiveTileKind = "done" | "live" | "waiting";

export interface LiveTile {
  index: number;
  kind: LiveTileKind;
  variant?: VariantTile;
  flight?: InFlight;
}

/** One tile per requested copy: finished thumb, live status, or queued. */
export function packLiveTiles(source: SourceProgress): LiveTile[] {
  const byIndex = new Map(source.variants.map((v) => [v.index, v]));
  const flights = source.inFlights || {};
  const n = Math.max(source.requested, source.variants.length);
  const tiles: LiveTile[] = [];
  for (let index = 1; index <= n; index++) {
    const variant = byIndex.get(index);
    if (variant?.file_url) {
      tiles.push({ index, kind: "done", variant });
      continue;
    }
    const flight = flights[index];
    tiles.push({
      index,
      kind: flight ? "live" : "waiting",
      flight,
    });
  }
  return tiles;
}

export function liveTileLabel(
  tile: LiveTile,
  preparing = false,
  upload?: { phase?: string } | null,
  waking = false,
): string {
  if (tile.kind === "done") {
    const pct = tile.variant?.uniqueness != null ? Math.round(tile.variant.uniqueness * 100) : null;
    return pct != null ? `${pct}%` : "ready";
  }
  if (tile.kind === "live") return tile.flight?.state ?? "render";
  if (preparing && upload && upload.phase !== "create") return "uploading";
  if (preparing) return "starting";
  if (waking) return "waking";
  return "queued";
}

/** Source poster while copies are still rendering. Prep ids have no file yet. */
export function liveTilePreviewSrc(source: SourceProgress): string | null {
  const poster = source.variants.find((v) => v.look_var_url)?.look_var_url
    ?? source.lookPreview?.var;
  return poster ?? null;
}

export function liveTileMediaSrc(tile: LiveTile, source: SourceProgress): string | null {
  if (tile.kind === "done") {
    return tile.variant?.look_var_url ?? liveTilePreviewSrc(source);
  }
  return liveTilePreviewSrc(source);
}

export function liveRowThumbSrc(source: SourceProgress | undefined): string | null {
  if (!source) return null;
  return source.variants.find((v) => v.look_var_url)?.look_var_url ?? liveTilePreviewSrc(source);
}
