/** Preview tile width in the gallery grid — small–medium, never native 1080. */
export const GALLERY_PREVIEW_TILE_PX = 168;

/** Phone grid min width — three to four tiles per row, not two large cards. */
export const GALLERY_MOBILE_TILE_MIN_PX = 80;

/** In-pane review filmstrip — 9:16, large enough to eat the empty stage. */
export const REVIEW_FILMSTRIP_TILE_W = 80;
export const REVIEW_FILMSTRIP_TILE_H = Math.round((REVIEW_FILMSTRIP_TILE_W * 16) / 9);

export function variantWipeHint(): string {
  return "DRAG THE DIVIDER TO WIPE · SPACE TO PLAY BOTH · ← → TO CHANGE VARIANT";
}

export function galleryPreviewTileClass(): string {
  return "gallery-tile";
}

export function galleryPreviewFrameClass(): string {
  return "gallery-tile__frame";
}
