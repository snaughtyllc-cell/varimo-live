"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { cssAspectRatio, DEFAULT_CSS_ASPECT, paintVideoFrame, videoFrameSrc } from "@/lib/media";

interface VideoThumbProps {
  src: string;
  badge?: ReactNode;
  className?: string;
  /** Fill a sized parent (gallery preview) instead of sizing to the video. */
  fill?: boolean;
  /** Mount the video immediately — live-queue tiles sit in overflow parents. */
  eager?: boolean;
}

export function VideoThumb({ src, badge, className, fill = false, eager = false }: VideoThumbProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(
    () => eager || typeof IntersectionObserver === "undefined",
  );
  const [aspect, setAspect] = useState(DEFAULT_CSS_ASPECT);

  useEffect(() => {
    setAspect(DEFAULT_CSS_ASPECT);
  }, [src]);

  useEffect(() => {
    if (eager) {
      setInView(true);
      return;
    }
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { rootMargin: "120px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  function applyVideoAspect(video: HTMLVideoElement | null) {
    if (!video) return;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setAspect(cssAspectRatio(video.videoWidth, video.videoHeight));
    }
    paintVideoFrame(video);
  }

  function handleMouseEnter() {
    const v = videoRef.current;
    if (!v) return;
    v.loop = true;
    v.play().catch(() => {/* autoplay may be blocked; silent fail */});
  }

  function handleMouseLeave() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
  }

  return (
    <div
      ref={boxRef}
      className={className}
      data-fill={fill || undefined}
      style={{
        aspectRatio: fill ? undefined : aspect,
        width: "100%",
        height: fill ? "100%" : undefined,
        alignSelf: fill ? "stretch" : "start",
        borderRadius: 6,
        position: "relative",
        overflow: "hidden",
        background: "#14141d",
        border: "1px solid var(--color-line)",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {inView && (
        <video
          ref={videoRef}
          src={videoFrameSrc(src)}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={() => applyVideoAspect(videoRef.current)}
          onLoadedData={() => applyVideoAspect(videoRef.current)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: fill ? "cover" : "contain",
            display: "block",
          }}
        />
      )}
      {badge && (
        <div
          style={{
            position: "absolute",
            bottom: 3,
            left: 3,
          }}
        >
          {badge}
        </div>
      )}
    </div>
  );
}
