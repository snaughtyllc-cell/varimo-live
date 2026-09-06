"use client";
import {
  captionNeedSourcesCopy,
  captionPromptLabelForSource,
  captionPromptPlaceholder,
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
      <label className="studio-option-row studio-caption-toggle" data-testid="studio-caption-toggle">
        <div>
          <div className="studio-option-row__label">{captionToggleLabel()}</div>
        </div>
        <input
          type="checkbox"
          checked={generateCaptions}
          onChange={(e) => onGenerateCaptionsChange(e.target.checked)}
        />
        <span className="studio-switch" data-on={generateCaptions} aria-hidden="true">
          <span className="studio-switch__thumb" />
        </span>
      </label>
      {generateCaptions && sources.length === 0 && (
        <p className="studio-caption-need-sources">{captionNeedSourcesCopy()}</p>
      )}
      {generateCaptions && sources.length > 0 && (
        <div className="studio-caption-sources">
          {sources.map((source, i) => (
            <div key={source.key} className="studio-caption-source" data-testid="studio-caption-source">
              <SourceThumb file={source.file} src={source.thumbUrl} label={source.name} />
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
        </div>
      )}
    </section>
  );
}
