"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { writeClipboardText } from "@/lib/clipboard";
import {
  captionCopyLabel,
  captionCopiedLabel,
  captionSnippet,
  stripInternalIndexLines,
} from "@/lib/prepareCopy";

export function CaptionSnippet({ caption }: { caption?: string | null }) {
  const preview = captionSnippet(caption);
  const full = stripInternalIndexLines(caption);
  const [copied, setCopied] = useState(false);
  const copiedReset = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copiedReset.current) window.clearTimeout(copiedReset.current);
    };
  }, []);
  if (!preview || !full) return null;

  async function copyCaption(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setCopied(true);
    if (copiedReset.current) window.clearTimeout(copiedReset.current);
    copiedReset.current = window.setTimeout(() => setCopied(false), 3000);
    // Card has no room for a blocked-clipboard error; keep Copied for the tap.
    void writeClipboardText(full);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "7px 8px 8px",
        background: "var(--color-panel)",
      }}
    >
      <p
        style={{
          margin: 0,
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          lineHeight: 1.4,
          color: "var(--color-muted)",
        }}
      >
        {preview}
      </p>
      <button
        type="button"
        onClick={(e) => void copyCaption(e)}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={copied ? captionCopiedLabel() : captionCopyLabel()}
        data-copied={copied ? "true" : "false"}
        style={{
          flex: "none",
          fontSize: 11,
          fontWeight: 700,
          padding: "8px 10px",
          minHeight: 32,
          borderRadius: 7,
          background: copied ? "#d8f3f6" : "#f3f8f9",
          border: copied ? "1px solid #0caab8" : "1px solid var(--color-line)",
          color: copied ? "#0a6e78" : "var(--color-text)",
          cursor: "pointer",
        }}
      >
        {copied ? captionCopiedLabel() : "Copy"}
      </button>
    </div>
  );
}
