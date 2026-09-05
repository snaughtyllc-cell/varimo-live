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
}

export function CompareSlider({ beforeSrc, afterSrc, videoRefs }: CompareSliderProps) {
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
      className="compare-slider"
      style={{
        position: "relative",
        aspectRatio: boxAspect,
        width: compareSliderWidth(boxAspect),
        maxHeight: "46dvh",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--color-line)",
        cursor: "ew-resize",
        userSelect: "none",
        touchAction: "pan-y",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* AFTER (variant) — bottom layer. Source stays muted so Play is the copy. */}
      <video
        ref={afterRef}
        src={videoFrameSrc(afterSrc)}
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
          top: 8,
          left: 8,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 6,
          color: "#fff",
          background: "#00000080",
          pointerEvents: "none",
        }}
      >
        SOURCE
      </span>
      <span
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 6,
          color: "#fff",
          background: "#00000080",
          pointerEvents: "none",
        }}
      >
        VARIANT
      </span>

      {/* Vertical handle line + grip */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pct}%`,
          width: 2,
          background: "#fff",
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
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#fff",
            color: "#111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            boxShadow: "0 2px 10px #000",
            touchAction: "none",
            pointerEvents: "auto",
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
          ⇄
        </div>
      </div>
    </div>
  );
}
