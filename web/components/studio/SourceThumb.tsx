"use client";
import { useEffect, useRef, useState } from "react";
import { paintVideoFrame, videoFrameSrc } from "@/lib/media";
import { captureVideoPoster } from "@/lib/videoPoster";

export function SourceThumb({
  file,
  src,
  label,
}: {
  file?: File;
  src?: string;
  label?: string;
}) {
  const [poster, setPoster] = useState("");
  const [blobUrl, setBlobUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbLabel = label ? `${label} thumbnail` : "Source thumbnail";

  useEffect(() => {
    if (!file) {
      setPoster("");
      setBlobUrl("");
      return;
    }
    let cancelled = false;
    let fallbackUrl = "";
    captureVideoPoster(file)
      .then((dataUrl) => {
        if (!cancelled) setPoster(dataUrl);
      })
      .catch(() => {
        if (cancelled) return;
        fallbackUrl = URL.createObjectURL(file);
        setBlobUrl(fallbackUrl);
      });
    return () => {
      cancelled = true;
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    };
  }, [file]);

  const videoSrc = blobUrl || (!file && src) || "";

  return (
    <div className="studio-source-thumb">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt={thumbLabel} />
      ) : videoSrc ? (
        <video
          ref={(el) => {
            videoRef.current = el;
            el?.setAttribute("webkit-playsinline", "");
          }}
          src={videoFrameSrc(videoSrc)}
          preload="auto"
          muted
          playsInline
          onLoadedMetadata={() => paintVideoFrame(videoRef.current)}
          onLoadedData={() => paintVideoFrame(videoRef.current)}
          aria-label={thumbLabel}
        />
      ) : (
        <div
          className="studio-source-thumb__ph"
          role={file ? undefined : "img"}
          aria-label={file ? undefined : thumbLabel}
          aria-hidden={file ? true : undefined}
        >
          {file ? "" : label || ""}
        </div>
      )}
    </div>
  );
}
