"use client";
import { CaptionBankPanel } from "@/components/drive/CaptionBankPanel";
import { captionToggleHint, captionToggleLabel } from "@/lib/prepareCopy";

export function StudioCaptionsBox({
  generateCaptions,
  onGenerateCaptionsChange,
}: {
  generateCaptions: boolean;
  onGenerateCaptionsChange: (value: boolean) => void;
}) {
  return (
    <section className="studio-captions-box" data-testid="studio-captions-box" aria-label="Captions">
      <h2>Captions</h2>
      <p className="studio-captions-box__lead">
        Write a post caption per copy on Generate, and keep folder banks for Drive exports.
      </p>
      <label className="studio-caption-toggle">
        <input
          type="checkbox"
          checked={generateCaptions}
          onChange={(e) => onGenerateCaptionsChange(e.target.checked)}
        />
        <span>
          {captionToggleLabel()}
          <small>{captionToggleHint()}</small>
        </span>
      </label>
      <CaptionBankPanel />
    </section>
  );
}
