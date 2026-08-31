"use client";
import {
  captionPromptLabel,
  captionPromptPlaceholder,
  captionToggleHint,
  captionToggleLabel,
} from "@/lib/prepareCopy";

export function StudioCaptionsBox({
  generateCaptions,
  onGenerateCaptionsChange,
  captionPrompt,
  onCaptionPromptChange,
}: {
  generateCaptions: boolean;
  onGenerateCaptionsChange: (value: boolean) => void;
  captionPrompt: string;
  onCaptionPromptChange: (value: string) => void;
}) {
  return (
    <section className="studio-captions-box" data-testid="studio-captions-box" aria-label="Captions">
      <h2>Captions</h2>
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
      {generateCaptions && (
        <textarea
          className="studio-caption-prompt"
          value={captionPrompt}
          onChange={(e) => onCaptionPromptChange(e.target.value)}
          placeholder={captionPromptPlaceholder()}
          aria-label={captionPromptLabel()}
          rows={5}
        />
      )}
    </section>
  );
}
