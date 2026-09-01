"use client";
import { useEffect, useRef, useState } from "react";
import { paintVideoFrame, videoFrameSrc } from "@/lib/media";

export function SourceThumb({
  file,
  src,
  label,
}: {
  file?: File;
  src?: string;
  label?: string;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!file) {
      setBlobUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const videoSrc = blobUrl || src || "";

  return (
    <div className="studio-source-thumb">
      {videoSrc ? (
        <video
          ref={videoRef}
          src={videoFrameSrc(videoSrc)}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={() => paintVideoFrame(videoRef.current)}
          onLoadedData={() => paintVideoFrame(videoRef.current)}
          aria-label={label ? `${label} thumbnail` : "Source thumbnail"}
        />
      ) : (
        <div className="studio-source-thumb__ph">{label || ""}</div>
      )}
    </div>
  );
}
