"use client";

import type { FileCacheProgress } from "@/lib/shareVideos";
import { sharePrepareBackgroundCopy, sharePrepareItemLabel, sharePrepareProgressCopy } from "@/lib/shareVideos";

export function SavePreparePanel({ progress }: { progress: FileCacheProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.ready / progress.total) * 100) : 0;
  const busy = progress.ready + progress.failed < progress.total;
  return (
    <div className="gallery-save-progress" aria-live="polite" aria-busy={busy}>
      <p className="gallery-save-progress__status">{sharePrepareProgressCopy(progress)}</p>
      {busy ? (
        <p className="gallery-save-progress__background">{sharePrepareBackgroundCopy()}</p>
      ) : null}
      <div
        className="gallery-save-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuenow={progress.ready}
        aria-valuemax={progress.total}
      >
        <span className="gallery-save-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <ol className="gallery-save-progress__list">
        {progress.items.map((item) => (
          <li key={item.file_url} data-state={item.state}>
            <span className="gallery-save-progress__name">{item.filename}</span>
            <span className="gallery-save-progress__state">{sharePrepareItemLabel(item.state)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
