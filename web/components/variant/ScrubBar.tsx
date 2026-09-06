"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import { clampTime } from "@/lib/media";
import { formatDuration } from "@/lib/format";

interface ScrubBarProps {
  /**
   * Array of video refs to control. The FIRST ref is the "timeline source" —
   * its currentTime and duration drive the position indicator and time label.
   * All refs are play/pause/seeked together.
   */
  videos: Array<React.RefObject<HTMLVideoElement | null>>;
  /** Seek + play around this timestamp when cueNonce changes. */
  cueTime?: number | null;
  cueNonce?: number;
  cuePad?: number;
}

export function ScrubBar({ videos, cueTime = null, cueNonce = 0, cuePad = 0.75 }: ScrubBarProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const primaryVideo = useCallback((): HTMLVideoElement | null => videos[0]?.current ?? null, [videos]);

  // Read duration from the first video whenever it loads metadata
  useEffect(() => {
    const v = primaryVideo();
    if (!v) return;
    const onMeta = () => setDuration(v.duration || 0);
    v.addEventListener("loadedmetadata", onMeta);
    if (v.duration) setDuration(v.duration);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [videos, primaryVideo]);

  // RAF loop for time updates while playing
  const startRaf = useCallback(() => {
    const tick = () => {
      const v = primaryVideo();
      if (v) setCurrentTime(v.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [primaryVideo]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopRaf();
  }, [stopRaf]);

  // Play / pause all videos
  const togglePlayPause = useCallback(() => {
    if (playing) {
      videos.forEach(r => r.current?.pause());
      stopRaf();
      setPlaying(false);
    } else {
      videos.forEach(r => { r.current?.play().catch(() => {}); });
      startRaf();
      setPlaying(true);
    }
  }, [playing, videos, startRaf, stopRaf]);

  useEffect(() => {
    if (!cueNonce || cueTime == null) return;
    const start = Math.max(0, Number(cueTime) - Math.max(0, cuePad));
    videos.forEach((r) => {
      const v = r.current;
      if (!v) return;
      v.currentTime = clampTime(start, v.duration || Number(cueTime) + cuePad);
      v.play().catch(() => {});
    });
    startRaf();
    setPlaying(true);
  }, [cueNonce, cueTime, cuePad, videos, startRaf]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== " " && e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      togglePlayPause();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayPause]);

  // Seek all videos to a fraction of the primary video's duration
  const seekToFraction = useCallback((fraction: number) => {
    const pv = primaryVideo();
    if (!pv) return;
    const targetTime = fraction * pv.duration;
    videos.forEach(r => {
      const v = r.current;
      if (!v) return;
      v.currentTime = clampTime(targetTime, v.duration);
    });
    setCurrentTime(clampTime(targetTime, pv.duration));
  }, [videos, primaryVideo]);

  const fractionFromEvent = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekToFraction(fractionFromEvent(e.clientX));
  }, [seekToFraction]);

  const onTrackPointerMove = useCallback((e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    seekToFraction(fractionFromEvent(e.clientX));
  }, [seekToFraction]);

  const onTrackPointerUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  const fraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const pct = fraction * 100;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Play / Pause */}
      <button
        onClick={togglePlayPause}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-cyan)",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 28 }} aria-hidden="true">
          {playing ? "pause_circle" : "play_circle"}
        </span>
      </button>

      {/* Progress track */}
      <div
        ref={trackRef}
        style={{
          flex: 1,
          height: 4,
          borderRadius: 99,
          background: "#24393f",
          position: "relative",
          cursor: "pointer",
          touchAction: "none",
        }}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        {/* Filled portion */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            borderRadius: 99,
            background: "var(--color-cyan)",
            pointerEvents: "none",
          }}
        />
        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#f6fbfb",
            boxShadow: "0 1px 6px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Time label */}
      <span
        style={{
          fontFamily: "var(--font-space-grotesk), monospace",
          fontSize: 11,
          color: "#9fb7bc",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </span>

      {/* Decorative state icons — both videos are always muted + looped so the
          two clips stay in lockstep; these reflect that rather than toggle it. */}
      <span
        className="material-symbols-rounded"
        role="img"
        aria-label="Muted for comparison"
        title="Muted for comparison"
        style={{ fontSize: 19, color: "#7e979d" }}
      >
        volume_off
      </span>
      <span
        className="material-symbols-rounded"
        role="img"
        aria-label="Loops automatically"
        title="Loops automatically"
        style={{ fontSize: 19, color: "#7e979d" }}
      >
        repeat
      </span>
    </div>
  );
}
