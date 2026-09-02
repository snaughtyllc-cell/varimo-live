"use client";
import { VideoThumb } from "../common/VideoThumb";
import { VariantOut } from "@/lib/types";
import { isFileReady } from "@/lib/gallery";
import { ESCALATED_BADGE, ESCALATED_TITLE } from "@/lib/format";
import { uniquenessGalleryBadgeTitle } from "@/lib/prepareCopy";
import { CaptionSnippet } from "./CaptionSnippet";
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
  const uniquenessOk = variant.uniqueness_status === "ok";
  const uniquenessFloorFail = variant.uniqueness_status === "below_floor";
  const viewsLabel = variantViewsCopy(
    variant.ig_insights?.views,
    Boolean(variant.ig_media_id || variant.ig_insights),
  );

  const badge = (
    <div
      style={{
        position: "absolute",
        inset: "auto 0 0 0",
        padding: "5px 6px",
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "linear-gradient(transparent, #000000bb)",
      }}
    >
      {uniquenessPct != null && (
        <span
          title={uniquenessGalleryBadgeTitle(uniquenessPct)}
          style={{
            fontSize: 9,
            fontWeight: 800,
            padding: "1px 5px",
            borderRadius: 5,
            background: uniquenessFloorFail ? "#3d1210" : uniquenessOk ? "#072830" : "#3d2200",
            color: uniquenessFloorFail ? "#f0a8a4" : uniquenessOk ? "#22d3ee" : "#f59e0b",
            border: `1px solid ${uniquenessFloorFail ? "#5a2a28" : uniquenessOk ? "#0c3d47" : "#4d2e00"}`,
            lineHeight: 1.4,
          }}
        >
          {uniquenessPct}%
        </span>
      )}
      {variant.escalated && (
        <span
          title={ESCALATED_TITLE}
          style={{
            fontSize: 8,
            fontWeight: 800,
            padding: "1px 5px",
            borderRadius: 5,
            background: "#1e1740",
            color: "#c7b8ff",
            border: "1px solid #362a68",
            lineHeight: 1.4,
          }}
        >
          {ESCALATED_BADGE}
        </span>
      )}
    </div>
  );

  const topBadges = (
    <div
      style={{
        position: "absolute",
        top: 5,
        right: 6,
        display: "flex",
        gap: 3,
        zIndex: 2,
      }}
    >
      {variant.platform_result === "duplicate_reject" && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 800,
            padding: "1px 5px",
            borderRadius: 5,
            background: "#fff8eb",
            color: "#8e6119",
            border: "1px solid #efdfbd",
          }}
        >
          ⚠
        </span>
      )}
      {variant.post_url && (
        <span
          title={variant.post_url}
          style={{
            fontSize: 8,
            fontWeight: 800,
            padding: "1px 5px",
            borderRadius: 5,
            background: "#072830",
            color: "#22d3ee",
            border: "1px solid #0c3d47",
          }}
        >
          link
        </span>
      )}
      {viewsLabel && (
        <span
          title="Instagram Insights views"
          style={{
            fontSize: 8,
            fontWeight: 800,
            padding: "1px 5px",
            borderRadius: 5,
            background: "#072830",
            color: "#e8f8f0",
            border: "1px solid #0c3d47",
          }}
        >
          {viewsLabel}
        </span>
      )}
    </div>
  );

  return (
    <div
      onClick={ready ? onOpen : undefined}
      style={{
        position: "relative",
        width: "100%",
        alignSelf: "start",
        borderRadius: 9,
        overflow: "hidden",
        cursor: ready ? "pointer" : "default",
        border: selected ? "1px solid #0caab8" : "1px solid var(--color-line)",
        boxShadow: selected ? "0 0 0 2px #0caab844" : undefined,
        transition: "transform 0.1s ease, box-shadow 0.1s ease, border-color 0.1s ease",
        opacity: ready ? 1 : 0.7,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 20px #00000055";
        (e.currentTarget as HTMLDivElement).style.borderColor = "#2f2a52";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "";
        (e.currentTarget as HTMLDivElement).style.boxShadow = selected ? "0 0 0 2px #0caab844" : "";
        (e.currentTarget as HTMLDivElement).style.borderColor = selected ? "#0caab8" : "var(--color-line)";
      }}
    >
      <input
        type="checkbox"
        disabled={!ready}
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          if (!ready) return;
          onToggle();
        }}
        aria-label={`Select v${String(variant.index).padStart(2, "0")}`}
        style={{
          position: "absolute",
          top: 5,
          left: 5,
          width: 13,
          height: 13,
          zIndex: 3,
          cursor: "pointer",
          accentColor: "#0caab8",
        }}
      />

      <div style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            top: 5,
            left: 22,
            fontSize: 9,
            color: "#fff",
            opacity: 0.8,
            fontWeight: 700,
            textShadow: "0 1px 3px #000",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          v{String(variant.index).padStart(2, "0")}
        </span>
        {ready ? (
          <VideoThumb src={variant.file_url} />
        ) : (
          <div
            style={{
              aspectRatio: "9 / 16",
              width: "100%",
              background: "#dce9eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 8,
              textAlign: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#8e6119",
            }}
          >
            Not on Studio
          </div>
        )}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {topBadges}
          {badge}
        </div>
      </div>
      <CaptionSnippet caption={captionOf(variant)} />
    </div>
  );
}
