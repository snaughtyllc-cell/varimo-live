import { describe, expect, it } from "vitest";
import { liveRowThumbSrc, liveTileLabel, liveTileMediaSrc, liveTilePreviewSrc, packLiveTiles } from "@/lib/studioLiveTiles";
import type { SourceProgress } from "@/lib/progress";

const quality = {
  vmaf: 96,
  histogram_ok: true,
  regen_count: 0,
  passed: true,
  spatial_vmaf: null,
  spatial_ok: null,
};

const source: SourceProgress = {
  source_id: "s1",
  filename: "clip.mp4",
  requested: 3,
  delivered: 1,
  done: 1,
  inFlights: { 2: { index: 2, state: "rendering", attempt: 0, max_attempts: 3 } },
  variants: [
    {
      index: 1,
      filename: "v01.mp4",
      status: "ok",
      quality,
      look_var_url: "/api/look/s1/look_v01.jpg",
      file_url: "/api/variants/s1/v01.mp4",
      uniqueness: 0.55,
    },
  ],
};

describe("packLiveTiles", () => {
  it("mixes a finished thumb with a live overlay and a queued slot", () => {
    const tiles = packLiveTiles(source);
    expect(tiles.map((t) => t.kind)).toEqual(["done", "live", "waiting"]);
    expect(tiles[0].variant?.file_url).toMatch(/v01/);
    expect(liveTileLabel(tiles[0])).toBe("55%");
    expect(liveTileLabel(tiles[1])).toBe("rendering");
    expect(liveTileLabel(tiles[2])).toBe("queued");
    expect(liveTileLabel(tiles[2], true)).toBe("starting");
    expect(liveTileLabel(tiles[2], true, { phase: "direct" })).toBe("uploading");
    expect(liveTileLabel(tiles[2], false, null, true)).toBe("waking");
  });

  it("uses JPEG posters for done tiles and never the source MP4", () => {
    const tiles = packLiveTiles(source);
    expect(liveTilePreviewSrc(source)).toBe("/api/look/s1/look_v01.jpg");
    expect(liveTileMediaSrc(tiles[0], source)).toBe("/api/look/s1/look_v01.jpg");
    expect(liveTileMediaSrc(tiles[1], source)).toBe("/api/look/s1/look_v01.jpg");
    expect(liveRowThumbSrc(source)).toBe("/api/look/s1/look_v01.jpg");
    expect(liveTilePreviewSrc({ ...source, variants: [], lookPreview: undefined })).toBeNull();
  });
});
