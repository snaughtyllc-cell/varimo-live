"use client";
import { useEffect, useRef, useState } from "react";
import { PlatformResult, VariantOut } from "@/lib/types";
import { regenerate, setPlatformResult } from "@/lib/api";
import {
  fillFileCache,
  filesReadyNow,
  isShareableVideo,
  phoneShareHintCopy,
  saveOrShareVideoFiles,
  shareVideosBusyLabel,
  shareVideosLabel,
  shouldOfferPhotosSave,
} from "@/lib/shareVideos";
import { PostLinkField } from "./PostLinkField";

interface VariantActionsProps {
  sourceId: string;
  variant: VariantOut;
  onRegenerate: () => void;
  onSendToDrive?: () => void;
}

const EYEBROW_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), monospace",
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--color-violet)",
};

export function VariantActions({ sourceId, variant, onRegenerate, onSendToDrive }: VariantActionsProps) {
  const [busy, setBusy] = useState(false);
  const [resultBusy, setResultBusy] = useState<PlatformResult | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [offerPhotos, setOfferPhotos] = useState(false);
  const fileCacheRef = useRef(new Map<string, File>());

  const saveRef = isShareableVideo(variant)
    ? [{ file_url: variant.file_url, filename: variant.filename }]
    : [];

  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    setOfferPhotos(shouldOfferPhotosSave(nav, nav?.userAgent, nav?.maxTouchPoints));
  }, []);

  function handleSaveVariant(e: React.MouseEvent) {
    e.preventDefault();
    if (saveBusy || saveRef.length === 0) return;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const ready = filesReadyNow(fileCacheRef.current, saveRef);
    setSaveBusy(true);
    const run = async (files: File[]) => {
      if (files.length === 0) return;
      await saveOrShareVideoFiles(files, {
        share: nav,
        userAgent: nav?.userAgent,
        maxTouchPoints: nav?.maxTouchPoints,
      });
    };
    const task = ready ? run(ready) : fillFileCache(fileCacheRef.current, saveRef).then(run);
    void task.catch((err) => console.error("Save variant failed", err)).finally(() => setSaveBusy(false));
  }

  async function handleRegenerate() {
    if (busy) return;
    setBusy(true);
    try {
      await regenerate(sourceId, 1);
      onRegenerate();
    } catch (e) {
      console.error("Regenerate failed", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetResult(result: PlatformResult) {
    if (resultBusy) return;
    setResultBusy(result);
    try {
      await setPlatformResult(sourceId, variant.index, result);
      onRegenerate();
    } catch (e) {
      console.error("Set platform result failed", e);
    } finally {
      setResultBusy(null);
    }
  }

  const currentResult = variant.platform_result ?? "unknown";
  const isStuck = currentResult === "flagged" || currentResult === "duplicate_reject";
  const isPassActive = !isStuck;
  const flagBusy = resultBusy === "flagged";

  const segmentBase: React.CSSProperties = {
    flex: 1,
    height: 38,
    borderRadius: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontSize: 12.5,
    fontWeight: 700,
    border: "none",
  };
  const segmentActive: React.CSSProperties = {
    background: "#fff",
    boxShadow: "0 1px 3px rgba(15,26,30,0.12)",
    color: "var(--color-text)",
  };
  const segmentInactive: React.CSSProperties = {
    background: "transparent",
    color: "#6e868c",
  };

  return (
    <div style={{ marginTop: 20 }}>
      {/* RESULT — Pass is unlabeled. Flag is the one miss action, for a live
          post that is stuck and not moving in views. Duplicate rejected lives
          on Drops / the ledger, not this sheet. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 9,
        }}
      >
        <div style={EYEBROW_STYLE}>Result</div>
        {isStuck && (
          <span
            data-testid="platform-result-badge"
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              color: "var(--color-orange)",
              background: "#fcf0e4",
              border: "1px solid #f0d3ae",
            }}
          >
            Stuck
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          padding: 4,
          borderRadius: 12,
          background: "var(--color-panel2)",
        }}
      >
        <div style={{ ...segmentBase, ...(isPassActive ? segmentActive : segmentInactive) }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-green)", flexShrink: 0 }} />
          Pass
        </div>

        <button
          type="button"
          onClick={() => handleSetResult("flagged")}
          disabled={!!resultBusy}
          style={{
            ...segmentBase,
            ...(isStuck ? segmentActive : segmentInactive),
            cursor: resultBusy ? "not-allowed" : "pointer",
            opacity: resultBusy && !flagBusy ? 0.6 : 1,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-amber)", flexShrink: 0 }} />
          {flagBusy ? "Saving…" : "Flag"}
        </button>
      </div>

      <div
        style={{
          marginTop: 9,
          fontFamily: "var(--font-space-grotesk), monospace",
          fontSize: 10,
          lineHeight: 1.5,
          letterSpacing: "0.04em",
          color: "var(--color-muted2)",
        }}
      >
        Unlabeled = pass. Flag when a live post is stuck and views aren't moving.
      </div>

      <div style={{ marginTop: 20 }}>
        <PostLinkField sourceId={sourceId} variant={variant} onSaved={onRegenerate} />
      </div>

      {/* Footer — pinned to the bottom of the scrolling metadata panel. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 20,
          paddingTop: 14,
          borderTop: "1px solid #eff5f6",
          background: "#fff",
          display: "flex",
          gap: 9,
        }}
      >
        {onSendToDrive && (
          <button
            type="button"
            onClick={onSendToDrive}
            className="variant-review__send"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 19 }} aria-hidden="true">
              cloud_upload
            </span>
            Send to Drive
          </button>
        )}
        {offerPhotos ? (
          <button
            type="button"
            title={phoneShareHintCopy()}
            onClick={handleSaveVariant}
            disabled={saveBusy}
            style={{
              flex: onSendToDrive ? undefined : 1,
              width: onSendToDrive ? 50 : undefined,
              height: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderRadius: 13,
              background: onSendToDrive ? "transparent" : "var(--ink)",
              border: onSendToDrive ? "1px solid var(--color-line)" : "none",
              color: onSendToDrive ? "#23393e" : "#f6fbfb",
              fontSize: 14,
              fontWeight: 700,
              cursor: saveBusy ? "wait" : "pointer",
              opacity: saveBusy ? 0.7 : 1,
            }}
            aria-label={onSendToDrive ? "Download variant" : undefined}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 19 }} aria-hidden="true">download</span>
            {!onSendToDrive && (saveBusy ? shareVideosBusyLabel() : shareVideosLabel(true))}
          </button>
        ) : (
          <a
            href={variant.file_url}
            download={variant.filename}
            aria-label="Download variant"
            style={{
              flex: onSendToDrive ? undefined : 1,
              width: onSendToDrive ? 50 : undefined,
              height: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderRadius: 13,
              background: onSendToDrive ? "transparent" : "var(--ink)",
              border: onSendToDrive ? "1px solid var(--color-line)" : "none",
              color: onSendToDrive ? "#23393e" : "#f6fbfb",
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 19 }} aria-hidden="true">download</span>
            {!onSendToDrive && "Download variant"}
          </a>
        )}

        <button
          type="button"
          onClick={handleRegenerate}
          disabled={busy}
          aria-label="Regenerate this one"
          title="Regenerate this one"
          style={{
            width: 50,
            height: 50,
            flexShrink: 0,
            borderRadius: 13,
            background: "transparent",
            border: "1px solid var(--color-line)",
            color: busy ? "var(--color-muted2)" : "#23393e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 20 }} aria-hidden="true">refresh</span>
        </button>
      </div>
    </div>
  );
}
