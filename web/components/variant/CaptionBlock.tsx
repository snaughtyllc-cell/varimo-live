"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { VariantOut } from "@/lib/types";
import { setVariantCaption } from "@/lib/api";
import {
  captionCopiedLabel,
  captionCopyLabel,
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

export function CaptionBlock({ sourceId, variant, onSaved }: CaptionBlockProps) {
  const saved = stripInternalIndexLines(variant.caption ?? "");
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(saved);
    setCopied(false);
  }, [saved, variant.index, sourceId]);

  const text = stripInternalIndexLines(draft);
  const canCopy = text.length > 0;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setVariantCaption(sourceId, variant.index, text);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save caption");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy caption");
    }
  }

  const actionStyle = (primary: boolean, disabled: boolean): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 700,
    padding: "10px 12px",
    borderRadius: 8,
    background: primary ? "var(--ink)" : "#f3f8f9",
    border: primary ? "1px solid var(--ink)" : "1px solid var(--color-line)",
    color: disabled ? "var(--color-muted)" : primary ? "#f6fbfb" : "var(--color-text)",
    cursor: disabled ? "not-allowed" : "pointer",
  });

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
        onChange={(e) => {
          setDraft(e.target.value);
          setCopied(false);
        }}
        placeholder={captionEmptyCopy()}
        aria-label={captionPreviewLabel()}
        disabled={busy}
        style={{ marginTop: 0, minHeight: 110 }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!canCopy}
          style={actionStyle(true, !canCopy)}
        >
          {copied ? captionCopiedLabel() : captionCopyLabel()}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          style={actionStyle(false, busy)}
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
