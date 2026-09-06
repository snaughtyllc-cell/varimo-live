"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareTouchIntent,
  releasePointerCaptureSafe,
  startsCompareDragImmediately,
} from "@/lib/compareGesture";
import { clipInset, cssAspectRatio, DEFAULT_CSS_ASPECT, paintVideoFrame, videoFrameSrc, compareSliderWidth } from "@/lib/media";

export interface CompareSliderVideoRefs {
  beforeRef: React.RefObject<HTMLVideoElement | null>;
  afterRef: React.RefObject<HTMLVideoElement | null>;
}

interface CompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  /** Optional external refs — Task 9 uses these to wire into ScrubBar */
  videoRefs?: CompareSliderVideoRefs;
  /** Gallery review stage: portrait player, not the 46dvh overlay box. */
  stage?: boolean;
}

export function CompareSlider({ beforeSrc, afterSrc, videoRefs, stage = false }: CompareSliderProps) {
  const [pct, setPct] = useState(54);
  const [boxAspect, setBoxAspect] = useState(DEFAULT_CSS_ASPECT);
  const dragging = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Internal refs — component works standalone without videoRefs
  const internalBeforeRef = useRef<HTMLVideoElement>(null);
  const internalAfterRef = useRef<HTMLVideoElement>(null);

  // The actual DOM refs are whichever were provided externally, else internal
  const beforeRef = videoRefs?.beforeRef ?? internalBeforeRef;
  const afterRef = videoRefs?.afterRef ?? internalAfterRef;

  const updatePct = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.min(100, Math.max(0, raw)));
  }, []);

  const endDrag = useCallback((e?: React.PointerEvent<HTMLElement>) => {
    dragging.current = false;
    start.current = null;
    if (e) releasePointerCaptureSafe(e.currentTarget, e.pointerId);
  }, []);

  // Failsafe: if iOS swallows pointerup on the node, don't leave dragging latched
  // (a latched drag + leftover capture eats Close / prev / next taps).
  useEffect(() => {
    const onUp = () => {
      dragging.current = false;
      start.current = null;
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, y: e.clientY };
    // Mouse/pen may capture so the split follows outside the pane.
    // Touch must not — leftover capture on iOS eats Close / prev / next taps.
    if (startsCompareDragImmediately(e.pointerType)) {
      dragging.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* some browsers refuse capture */
      }
      updatePct(e.clientX);
    }
  }, [updatePct]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (dragging.current) {
      updatePct(e.clientX);
      return;
    }
    if (!start.current || e.pointerType !== "touch") return;
    const intent = compareTouchIntent(
      e.clientX - start.current.x,
      e.clientY - start.current.y,
    );
    if (intent === "undecided") return;
    if (intent === "scroll") {
      start.current = null;
      return;
    }
    dragging.current = true;
    updatePct(e.clientX);
  }, [updatePct]);

  useEffect(() => {
    setBoxAspect(DEFAULT_CSS_ASPECT);
  }, [afterSrc]);

  function handleAfterMetadata() {
    const v = afterRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      setBoxAspect(cssAspectRatio(v.videoWidth, v.videoHeight));
    }
    paintVideoFrame(v);
  }

  const videoStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    // contain: letterbox inside the box so a 16:9 clip is not cover-cropped
    // while we still default to 9:16 before metadata arrives.
    objectFit: "contain",
    display: "block",
    pointerEvents: "none",
  };

  return (
    <div
      ref={containerRef}
      className={stage ? "compare-slider compare-slider--stage" : "compare-slider"}
      style={{
        position: "relative",
        aspectRatio: stage ? "9 / 16" : boxAspect,
        width: stage ? undefined : compareSliderWidth(boxAspect),
        maxHeight: stage ? undefined : "46dvh",
        borderRadius: 14,
        overflow: "hidden",
        background: "#0b171b",
        border: "none",
        cursor: "ew-resize",
        userSelect: "none",
        touchAction: "pan-y",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* AFTER (variant) — bottom layer, fills entire box */}
      <video
        ref={afterRef}
        src={videoFrameSrc(afterSrc)}
        muted
        playsInline
        preload="metadata"
        loop
        controls={false}
        disablePictureInPicture
        onLoadedMetadata={handleAfterMetadata}
        onLoadedData={() => paintVideoFrame(afterRef.current)}
        style={videoStyle}
      />

      {/* BEFORE (source) — top layer, clipped to reveal only left pct% */}
      <video
        ref={beforeRef}
        src={videoFrameSrc(beforeSrc)}
        muted
        playsInline
        preload="metadata"
        loop
        controls={false}
        disablePictureInPicture
        onLoadedMetadata={() => paintVideoFrame(beforeRef.current)}
        onLoadedData={() => paintVideoFrame(beforeRef.current)}
        style={{
          ...videoStyle,
          clipPath: clipInset(pct),
        }}
      />

      {/* Pill labels */}
      <span
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          fontFamily: "var(--font-space-grotesk), monospace",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          padding: "4px 8px",
          borderRadius: 5,
          color: "#c9dde0",
          background: "rgba(11,34,38,0.8)",
          pointerEvents: "none",
        }}
      >
        Source
      </span>
      <span
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          fontFamily: "var(--font-space-grotesk), monospace",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          padding: "4px 8px",
          borderRadius: 5,
          color: "#0b2226",
          background: "var(--color-cyan)",
          pointerEvents: "none",
        }}
      >
        Variant
      </span>

      {/* Vertical handle line + grip */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pct}%`,
          width: 2,
          background: "var(--color-cyan)",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: "var(--color-cyan)",
            color: "#0b2226",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            boxShadow: "0 8px 22px -8px rgba(0,0,0,0.7)",
            touchAction: "none",
            pointerEvents: "auto",
            cursor: "grab",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = true;
            start.current = { x: e.clientX, y: e.clientY };
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* iOS may refuse capture */
            }
            updatePct(e.clientX);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => endDrag()}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 21 }} aria-hidden="true">
            drag_indicator
          </span>
        </div>
      </div>
    </div>
  );
}
