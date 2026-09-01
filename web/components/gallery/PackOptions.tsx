"use client";
import { useEffect, useState } from "react";
import type { SourceOut } from "@/lib/types";
import { rewriteSourceCaptions } from "@/lib/api";
import {
  packCaptionSeed,
  packOptionsLabel,
  rewriteCaptionsBusy,
  rewriteCaptionsHint,
  rewriteCaptionsLabel,
  rewriteCaptionsSeedLabel,
} from "@/lib/prepareCopy";

export function PackOptions({
  source,
  disabled,
  onRewritten,
}: {
  source: SourceOut;
  disabled?: boolean;
  onRewritten: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(() => packCaptionSeed(source));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSeed(packCaptionSeed(source));
  }, [source.source_id, source.caption_prompt]);

  async function rewrite() {
    if (busy || disabled) return;
    const prompt = seed.trim();
    if (!prompt) {
      setError("Write a seed caption first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rewriteSourceCaptions(source.source_id, prompt);
      onRewritten();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rewrite captions");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gallery-pack-options">
      <button
        type="button"
        className="gallery-pack-options__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {packOptionsLabel()}
      </button>
      {open && (
        <div className="gallery-pack-options__panel">
          <p>{rewriteCaptionsHint()}</p>
          <label>
            {rewriteCaptionsSeedLabel()}
            <textarea
              className="studio-caption-prompt"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              disabled={busy || disabled}
              rows={3}
              aria-label={rewriteCaptionsSeedLabel()}
            />
          </label>
          <button
            type="button"
            onClick={() => void rewrite()}
            disabled={busy || disabled}
          >
            {busy ? rewriteCaptionsBusy() : rewriteCaptionsLabel()}
          </button>
          {error && <div className="gallery-pack-options__error">{error}</div>}
        </div>
      )}
    </div>
  );
}
