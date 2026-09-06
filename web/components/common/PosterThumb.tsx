"use client";
import { ReactNode } from "react";

interface PosterThumbProps {
  src?: string | null;
  badge?: ReactNode;
  className?: string;
  fill?: boolean;
  label?: string;
}

/** Static poster only — never mounts a <video>, so Gallery scroll does not request MP4s. */
export function PosterThumb({
  src,
  badge,
  className,
  fill = false,
  label,
}: PosterThumbProps) {
  return (
    <div
      className={className}
      data-fill={fill || undefined}
      data-poster="true"
      style={{
        aspectRatio: fill ? undefined : "9 / 16",
        width: "100%",
        height: fill ? "100%" : undefined,
        alignSelf: fill ? "stretch" : "start",
        borderRadius: 6,
        position: "relative",
        overflow: "hidden",
        background: "#14141d",
        border: "1px solid var(--color-line)",
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: fill ? "cover" : "contain",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-muted2)",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {label ?? "Ready"}
        </div>
      )}
      {badge && (
        <div style={{ position: "absolute", bottom: 3, left: 3 }}>{badge}</div>
      )}
    </div>
  );
}
