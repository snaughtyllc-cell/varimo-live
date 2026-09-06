"use client";
import { PosterThumb } from "../common/PosterThumb";
import { VariantOut } from "@/lib/types";
import { isFileReady, tileOriginalityColor } from "@/lib/gallery";
import { ESCALATED_BADGE, ESCALATED_TITLE } from "@/lib/format";
import { CaptionSnippet } from "./CaptionSnippet";
import { galleryPreviewFrameClass, galleryPreviewTileClass } from "@/lib/galleryLayout";
import { variantViewsCopy } from "@/lib/instagram";

interface VariantCardProps {
  variant: VariantOut;
  sourceId: string;
  onOpen: () => void;
  selected: boolean;
  onToggle: () => void;
}

function captionOf(v: { caption?: string | null }): string | null | undefined {
  return v.caption;
}

export function VariantCard({ variant, onOpen, selected, onToggle }: VariantCardProps) {
  const ready = isFileReady(variant);
  const uniquenessPct = variant.uniqueness != null ? Math.round(variant.uniqueness * 100) : null;
  const uniquenessFloorFail = variant.uniqueness_status === "below_floor";
  const viewsLabel = variantViewsCopy(
    variant.ig_insights?.views,
    Boolean(variant.ig_media_id || variant.ig_insights),
  );

  const badge = uniquenessPct != null && (
    <span
      className="gallery-tile__pct"
      style={{
        background: uniquenessFloorFail ? "#3d1210" : "rgba(11,34,38,0.72)",
        color: uniquenessFloorFail ? "#f0a8a4" : tileOriginalityColor(uniquenessPct),
      }}
    >
      {uniquenessPct}%
    </span>
  );

  const topBadges = (
    <div className="gallery-tile__badges">
      {variant.platform_result === "duplicate_reject" && (
        <span className="gallery-tile__flag" title="Duplicate — flagged by the platform">
          ⚠
        </span>
      )}
      {variant.escalated && (
        <span className="gallery-tile__flag gallery-tile__flag--esc" title={ESCALATED_TITLE}>
          {ESCALATED_BADGE}
        </span>
      )}
      {variant.post_url && (
        <span className="gallery-tile__flag gallery-tile__flag--link" title={variant.post_url}>
          link
        </span>
      )}
      {viewsLabel && (
        <span
          className="gallery-tile__flag gallery-tile__flag--views"
          title="Instagram Insights views"
        >
          {viewsLabel}
        </span>
      )}
    </div>
  );

  return (
    <div className={galleryPreviewTileClass()}>
      <div
        className={galleryPreviewFrameClass()}
        data-ready={ready}
        data-selected={selected}
        style={{ aspectRatio: "9 / 16" }}
        onClick={ready ? onOpen : undefined}
      >
        <input
          type="checkbox"
          className="gallery-tile__check"
          disabled={!ready}
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            if (!ready) return;
            onToggle();
          }}
          aria-label={`Select v${String(variant.index).padStart(2, "0")}`}
        />

        <span className="gallery-tile__id">v{String(variant.index).padStart(2, "0")}</span>
        <div className="gallery-tile__media">
          {ready ? (
            <PosterThumb
              src={variant.look_var_url}
              className="gallery-tile__thumb"
              fill
              label={`v${String(variant.index).padStart(2, "0")}`}
            />
          ) : (
            <div className="gallery-tile__placeholder" style={{ aspectRatio: "9 / 16" }}>
              Not ready
            </div>
          )}
        </div>
        <div className="gallery-tile__overlay" style={{ pointerEvents: "none" }}>
          {topBadges}
          {badge}
        </div>
      </div>
      <CaptionSnippet caption={captionOf(variant)} />
    </div>
  );
}
