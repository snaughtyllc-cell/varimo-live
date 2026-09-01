"use client";
import { useEffect, useState } from "react";
import { VariantOut } from "@/lib/types";
import { setVariantCaption } from "@/lib/api";
import {
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(saved);
  }, [saved, variant.index, sourceId]);

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
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        style={{
          marginTop: 8,
          fontSize: 12.5,
          fontWeight: 700,
          padding: "10px 12px",
          borderRadius: 8,
          background: "#f3f8f9",
          border: "1px solid var(--color-line)",
          color: busy ? "var(--color-muted)" : "var(--color-text)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : captionSaveLabel()}
      </button>
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-red)" }}>{error}</div>
      )}
    </div>
  );
}
