"use client";

import type { SourceOut } from "@/lib/types";
import { packLiveStripModel } from "@/lib/instagram";

export function PackLiveStrip({ source }: { source: SourceOut }) {
  const model = packLiveStripModel(source);
  return (
    <section
      className="gallery-pack-live"
      data-preview={model.preview ? "true" : undefined}
      aria-label="Pack insights"
    >
      <div className="gallery-pack-live__head">
        <span className="gallery-pack-live__label">
          {model.preview ? "Sample Insights" : "Live Insights"}
        </span>
        <span className="gallery-pack-live__linked">{model.linkedCopy}</span>
      </div>
      <div className="gallery-pack-live__metrics">
        {model.metrics.map((metric) => (
          <div className="gallery-pack-live__metric" key={metric.label}>
            <span className="gallery-pack-live__value">{metric.value}</span>
            <span className="gallery-pack-live__key">{metric.label}</span>
          </div>
        ))}
      </div>
      {model.hint && (
        <p className="gallery-pack-live__hint" data-kind={model.hintKind ?? undefined}>
          {model.hint}
        </p>
      )}
    </section>
  );
}
