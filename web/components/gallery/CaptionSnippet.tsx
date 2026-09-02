"use client";
import { useState, type MouseEvent } from "react";
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
  if (!preview || !full) return null;

  async function copyCaption(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const ok = await writeClipboardText(full);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
        aria-label={captionCopyLabel()}
        style={{
          flex: "none",
          fontSize: 11,
          fontWeight: 700,
          padding: "6px 8px",
          borderRadius: 7,
          background: "#f3f8f9",
          border: "1px solid var(--color-line)",
          color: "var(--color-text)",
          cursor: "pointer",
        }}
      >
        {copied ? captionCopiedLabel() : "Copy"}
      </button>
    </div>
  );
}
