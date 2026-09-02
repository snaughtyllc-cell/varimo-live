"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { VariantOut } from "@/lib/types";
import { setVariantCaption } from "@/lib/api";
import { writeClipboardText } from "@/lib/clipboard";
import {
  captionCopyBlockedCopy,
  captionCopyLabel,
  captionCopiedLabel,
  captionEmptyCopy,
  captionPreviewLabel,
  captionSaveLabel,
  captionStatusHint,
  stripInternalIndexLines,
} from "@/lib/prepareCopy";

interface CaptionBlockProps {
  sourceId: string;
  variant: VariantOut;
  onSaved: () => void;
}

const actionBtnStyle = (opts: { muted?: boolean }): CSSProperties => ({
  marginTop: 0,
  fontSize: 12.5,
  fontWeight: 700,
  padding: "10px 12px",
  borderRadius: 8,
  background: "#f3f8f9",
  border: "1px solid var(--color-line)",
  color: opts.muted ? "var(--color-muted)" : "var(--color-text)",
  cursor: opts.muted ? "not-allowed" : "pointer",
});

export function CaptionBlock({ sourceId, variant, onSaved }: CaptionBlockProps) {
  const saved = stripInternalIndexLines(variant.caption ?? "");
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(saved);
  }, [saved, variant.index, sourceId]);

  const cleanedDraft = stripInternalIndexLines(draft);
  const canCopy = Boolean(cleanedDraft);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setVariantCaption(sourceId, variant.index, stripInternalIndexLines(draft));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save caption");
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    if (!canCopy) return;
    setError(null);
    const ok = await writeClipboardText(cleanedDraft);
    if (!ok) {
      setError(captionCopyBlockedCopy());
      setCopied(false);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.7px",
          color: "var(--color-muted2)",
          fontWeight: 700,
          margin: "0 0 8px",
        }}
      >
        {captionPreviewLabel()}
      </div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 11.5,
          lineHeight: 1.45,
          color: "var(--color-muted)",
        }}
      >
        {captionStatusHint()}
      </p>
      <textarea
        className="studio-caption-prompt"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={captionEmptyCopy()}
        aria-label={captionPreviewLabel()}
        disabled={busy}
        style={{ marginTop: 0, minHeight: 110 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void copyCaption()}
          disabled={!canCopy}
          style={actionBtnStyle({ muted: !canCopy })}
        >
          {copied ? captionCopiedLabel() : captionCopyLabel()}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          style={actionBtnStyle({ muted: busy })}
        >
          {busy ? "Saving…" : captionSaveLabel()}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-red)" }}>{error}</div>
      )}
    </div>
  );
}
