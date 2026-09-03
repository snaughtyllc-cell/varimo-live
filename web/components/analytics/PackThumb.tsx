"use client";

import { useRef } from "react";
import { analyticsPackThumb } from "@/lib/instagram";
import { paintVideoFrame, videoFrameSrc } from "@/lib/media";
import type { SourceOut } from "@/lib/types";

export function PackThumb({
  source,
  className,
}: {
  source?: SourceOut;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumb = analyticsPackThumb(source);
  if (!thumb) return null;
  if (thumb.kind === "image") {
    return <img className={className} src={thumb.src} alt="" />;
  }
  return (
    <video
      ref={videoRef}
      className={className}
      src={videoFrameSrc(thumb.src)}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={() => paintVideoFrame(videoRef.current)}
      onLoadedData={() => paintVideoFrame(videoRef.current)}
    />
  );
}
