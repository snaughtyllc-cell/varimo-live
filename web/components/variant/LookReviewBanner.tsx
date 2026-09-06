"use client";
import type { CSSProperties } from "react";
import type { VariantOut } from "@/lib/types";
import {
  LOOK_LUMA_MAX,
  lookApproveLabel,
  lookApprovedLabel,
  lookApprovalValid,
  lookIsDeliverable,
  lookPlaybackLabel,
  lookReviewBody,
  lookReviewTitle,
  lookStillsNote,
  normalizeLookStatus,
} from "@/lib/lookCopy";

interface LookReviewBannerProps {
  variant: VariantOut;
  busy?: boolean;
  onPlayMoment?: () => void;
  onApprove?: () => void;
}

const box: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 12px",
  marginBottom: 12,
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.45,
};

export function LookReviewBanner({
  variant,
  busy,
  onPlayMoment,
  onApprove,
}: LookReviewBannerProps) {
  const status = normalizeLookStatus(variant.look_status);
  const title = lookReviewTitle(status);
  const body = lookReviewBody(status);
  if (!title || !body) return null;

  const frames = variant.look_frames || variant.quality?.look_frames || [];
  const maeMax = variant.look_mae_max ?? variant.quality?.look_mae_max ?? variant.look_mae;
  const cropKeep = variant.quality?.look_crop?.crop_keep;
  const approved = lookApprovalValid(variant.look_artifact_sha256, variant.look_approved_sha256);
  const deliverable = lookIsDeliverable(
    status,
    variant.look_artifact_sha256,
    variant.look_approved_sha256,
  );
  const reviewT = variant.look_review_t ?? variant.quality?.look_review_t ?? null;
  const warn = status === "review_required" && !approved;

  return (
    <div
      data-look-review={status}
      style={{
        ...box,
        color: warn ? "var(--color-amber)" : "var(--color-muted)",
        background: warn ? "#fdf9ef" : "var(--color-panel2)",
        border: `1px solid ${warn ? "var(--color-amber2)" : "var(--color-line)"}`,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--color-text)" }}>{title}</div>
      <p style={{ margin: 0 }}>{body}</p>
      {(maeMax != null || frames.length > 0 || cropKeep != null) && (
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), monospace",
            fontSize: 10.5,
            color: "var(--color-muted2)",
          }}
        >
          {maeMax != null ? `max MAE ${maeMax} / ${LOOK_LUMA_MAX}` : null}
          {frames.length > 0
            ? ` · frames ${frames.map((f) => (f.mae != null ? f.mae : "—")).join(" / ")}`
            : null}
          {cropKeep != null ? ` · crop keep ${cropKeep}` : null}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 11, color: "var(--color-muted2)" }}>{lookStillsNote()}</p>
      {(variant.look_src_url || variant.look_var_url) && (
        <div style={{ display: "flex", gap: 8 }}>
          {variant.look_src_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={variant.look_src_url}
              alt="Flagged source frame"
              width={72}
              height={128}
              style={{ objectFit: "cover", borderRadius: 6, background: "#14252a" }}
            />
          ) : null}
          {variant.look_var_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={variant.look_var_url}
              alt="Flagged variant frame"
              width={72}
              height={128}
              style={{ objectFit: "cover", borderRadius: 6, background: "#14252a" }}
            />
          ) : null}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {status === "review_required" && reviewT != null && onPlayMoment && (
          <button
            type="button"
            onClick={onPlayMoment}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-line)",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {lookPlaybackLabel()}
          </button>
        )}
        {status === "review_required" && !approved && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-line)",
              background: "#fff",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {lookApproveLabel()}
          </button>
        )}
        {status === "review_required" && approved && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-mint)" }}>
            {lookApprovedLabel()}
          </span>
        )}
      </div>
      {status === "unknown" && !deliverable ? (
        <span style={{ fontSize: 11, color: "var(--color-muted2)" }}>Not look-approved.</span>
      ) : null}
    </div>
  );
}
