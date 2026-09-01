"use client";
import {
  captionNeedSourcesCopy,
  captionPromptLabelForSource,
  captionPromptPlaceholder,
  captionToggleHint,
  captionToggleLabel,
  sourceCaptionEyebrow,
} from "@/lib/prepareCopy";
import { SourceThumb } from "./SourceThumb";

export type CaptionSource = {
  key: string;
  name: string;
  file?: File;
  thumbUrl?: string;
};

export function StudioCaptionsBox({
  generateCaptions,
  onGenerateCaptionsChange,
  sources,
  prompts,
  onPromptChange,
}: {
  generateCaptions: boolean;
  onGenerateCaptionsChange: (value: boolean) => void;
  sources: CaptionSource[];
  prompts: string[];
  onPromptChange: (index: number, value: string) => void;
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
      {generateCaptions && sources.length === 0 && (
        <p className="studio-caption-need-sources">{captionNeedSourcesCopy()}</p>
      )}
      {generateCaptions &&
        sources.map((source, i) => (
          <div key={source.key} className="studio-caption-source" data-testid="studio-caption-source">
            <SourceThumb file={source.file} src={source.thumbUrl} label={`S${i + 1}`} />
            <div className="studio-caption-source__fields">
              <p className="studio-caption-source__eyebrow">
                {sourceCaptionEyebrow(i, sources.length)}
              </p>
              <b className="studio-caption-source__name">{source.name}</b>
              <textarea
                className="studio-caption-prompt"
                value={prompts[i] ?? ""}
                onChange={(e) => onPromptChange(i, e.target.value)}
                placeholder={captionPromptPlaceholder()}
                aria-label={captionPromptLabelForSource(i, sources.length)}
                rows={4}
              />
            </div>
          </div>
        ))}
    </section>
  );
}
