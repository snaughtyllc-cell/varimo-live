import { describe, expect, it } from "vitest";
import {
  GALLERY_MOBILE_TILE_MIN_PX,
  GALLERY_PREVIEW_TILE_PX,
  REVIEW_FILMSTRIP_TILE_H,
  REVIEW_FILMSTRIP_TILE_W,
  galleryPreviewFrameClass,
  galleryPreviewTileClass,
  variantWipeHint,
} from "@/lib/galleryLayout";

describe("gallery preview tile size", () => {
  it("caps preview tiles at a small–medium width, not native 1080", () => {
    expect(GALLERY_PREVIEW_TILE_PX).toBeGreaterThanOrEqual(140);
    expect(GALLERY_PREVIEW_TILE_PX).toBeLessThanOrEqual(180);
  });

  it("sizes phone tiles so three to four fit in a row", () => {
    expect(GALLERY_MOBILE_TILE_MIN_PX).toBeGreaterThanOrEqual(72);
    expect(GALLERY_MOBILE_TILE_MIN_PX).toBeLessThanOrEqual(96);
    expect(GALLERY_MOBILE_TILE_MIN_PX).toBeLessThan(GALLERY_PREVIEW_TILE_PX);
  });

  it("names the locked preview frame classes", () => {
    expect(galleryPreviewTileClass()).toBe("gallery-tile");
    expect(galleryPreviewFrameClass()).toBe("gallery-tile__frame");
  });

  it("sizes review filmstrip tiles to fill the stage, not postage stamps", () => {
    expect(REVIEW_FILMSTRIP_TILE_W).toBeGreaterThanOrEqual(72);
    expect(REVIEW_FILMSTRIP_TILE_W).toBeLessThanOrEqual(112);
    expect(REVIEW_FILMSTRIP_TILE_H).toBe(Math.round((REVIEW_FILMSTRIP_TILE_W * 16) / 9));
  });

  it("keeps the wipe-hint copy used on the in-pane review", () => {
    expect(variantWipeHint()).toMatch(/DRAG THE DIVIDER TO WIPE/i);
    expect(variantWipeHint()).toMatch(/SPACE TO PLAY BOTH/i);
  });
});
