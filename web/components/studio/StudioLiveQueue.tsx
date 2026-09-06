"use client";
import { useState } from "react";
import Link from "next/link";
import { cancelJob } from "@/lib/api";
import { useQueue } from "@/lib/useQueue";
import { useRun } from "@/lib/runStore";
import { displayClipName, jobCanCancel } from "@/lib/queue";
import {
  isPreparingJob,
  preparingSubcopy,
  wakingSubcopy,
} from "@/lib/prepareCopy";
import { uploadProgressCopy } from "@/lib/jobUpload";
import { reconstructFirstHeadline, reconstructFirstSubcopy } from "@/lib/hqWaitCopy";
import { runHasStarted } from "@/lib/progress";
import { useElapsedSeconds } from "@/lib/useElapsedSeconds";
import { liveRowThumbSrc, liveTileLabel, liveTileMediaSrc, packLiveTiles } from "@/lib/studioLiveTiles";
import { PosterThumb } from "@/components/common/PosterThumb";
import type { SourceProgress } from "@/lib/progress";

interface QueueRow {
  key: string;
  name: string;
  label: string;
  pct: number;
  cancelId?: string;
}

function LivePackGrid({
  source,
  preparing,
  upload,
  waking,
}: {
  source: SourceProgress;
  preparing: boolean;
  upload?: { phase?: string } | null;
  waking?: boolean;
}) {
  const tiles = packLiveTiles(source);
  return (
    <div className="studio-live__grid" data-testid={`live-grid-${source.source_id}`}>
      {tiles.map((tile) => {
        const label = `v${String(tile.index).padStart(2, "0")}`;
        const media = liveTileMediaSrc(tile, source);
        const live = tile.kind === "live";
        return (
          <div
            className={tile.kind === "done" ? "studio-live-tile" : "studio-live-tile studio-live-tile--slot"}
            key={tile.index}
            data-tile={tile.kind}
            data-has-thumb={media ? "true" : undefined}
            data-slot-state={tile.kind === "done" ? undefined : tile.flight?.state ?? "waiting"}
          >
            {media ? <PosterThumb src={media} className="studio-live-tile__thumb" fill /> : null}
            {tile.kind !== "done" && media ? <span className="studio-live-tile__scrim" aria-hidden="true" /> : null}
            <span className="studio-live-tile__v">{label}</span>
            <span
              className={
                tile.kind === "done"
                  ? "studio-live-tile__pct"
                  : live || preparing || waking
                    ? "studio-live-tile__status vf-live-shimmer"
                    : "studio-live-tile__status"
              }
            >
              {liveTileLabel(tile, preparing, upload, waking)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Persistent dark LIVE QUEUE rail (mock "Studio · web", right column).
 * Wired to the real shared queue (`useQueue`) plus this browser's own run
 * (`useRun` → live SSE progress + finished tiles). No fabricated data:
 * rows are running packs, tiles are variants this session actually finished.
 */
export function StudioLiveQueue() {
  const { data: queue, mutate } = useQueue();
  const { jobId, progress, complete, prepMode, upload, waitStartedAt } = useRun();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const runSources = Object.values(progress.bySource);
  const activeRun = Boolean(jobId) && !complete;
  const localInQueue = jobId ? queue.jobs.some((j) => j.job_id === jobId) : false;
  const localDelivered = runSources.reduce((sum, s) => sum + s.delivered, 0);

  const running = queue.running + (activeRun && !localInQueue ? 1 : 0);
  const done =
    queue.jobs.reduce((sum, j) => sum + j.delivered, 0) + (localInQueue ? 0 : localDelivered);

  // Live rows for this browser's own run before the shared queue registers it,
  // then the queue's authoritative rows (which include everyone's packs).
  const runRows: QueueRow[] =
    activeRun && !localInQueue
      ? runSources.map((s) => ({
          key: `run-${s.source_id}`,
          name: displayClipName(s.filename),
          label: `${s.delivered}/${s.requested}`,
          pct: s.requested > 0 ? Math.min(100, Math.round((s.done / s.requested) * 100)) : 0,
          cancelId: jobId && !isPreparingJob(jobId) ? jobId : undefined,
        }))
      : [];

  const queueRows: QueueRow[] = queue.jobs.map((j) => {
    const first = displayClipName(j.filenames[0] ?? "clip");
    const extra = j.filenames.length > 1 ? ` +${j.filenames.length - 1}` : "";
    return {
      key: `job-${j.job_id}`,
      name: `${first}${extra}`,
      label: `${j.delivered}/${j.requested}`,
      pct: j.requested > 0 ? Math.min(100, Math.round((j.delivered / j.requested) * 100)) : 0,
      cancelId: jobCanCancel(j.state) ? j.job_id : undefined,
    };
  });

  const rows = [...runRows, ...queueRows];

  const preparing = isPreparingJob(jobId);
  const started = runHasStarted(progress);
  const waking = Boolean(jobId) && !complete && !progress.failed && !started && !preparing && prepMode !== "hq";
  const waitActive = preparing || waking;
  const elapsed = useElapsedSeconds(waitActive, waitStartedAt);
  const uploadLine = preparing && upload ? uploadProgressCopy(upload) : "";
  const waitLine = preparing
    ? (uploadLine || preparingSubcopy(elapsed))
    : waking
      ? wakingSubcopy(elapsed, progress.waitPhase)
      : "";
  const showLiveGrids = runSources.some((s) => s.requested > 0);
  const previewSource =
    runSources.find((s) => s.source_id && !s.source_id.startsWith("prep-")) ?? runSources[0];
  const rowThumb = liveRowThumbSrc(previewSource);

  async function handleCancel(id: string) {
    if (cancellingId) return;
    setCancellingId(id);
    try {
      await cancelJob(id);
      await mutate();
    } catch {
      // Poll drops the row once the job actually closes.
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <aside className="studio-live" aria-label="Live queue">
      <div className="studio-live__head">
        <span className="studio-live__title">LIVE QUEUE</span>
        <span className="studio-live__count">
          {running} running · {done} done
        </span>
      </div>

      {progress.failed && !complete && (
        <p className="studio-live__failed">{progress.failed}</p>
      )}
      {waitLine ? (
        <p className="studio-live__wait" data-testid="live-queue-wait">
          {waitLine}
        </p>
      ) : null}
      {prepMode === "hq" && Boolean(jobId) && !complete && !isPreparingJob(jobId) && !runHasStarted(progress) && (
        <p className="studio-live__failed" data-testid="hq-reconstruct-copy">
          {reconstructFirstHeadline()} {reconstructFirstSubcopy()}
        </p>
      )}

      <div className="studio-live__rows">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div className="studio-live-row" key={row.key}>
              <div className="studio-live-row__thumb">
                {rowThumb ? (
                  <PosterThumb src={rowThumb} className="studio-live-row__thumb-img" fill />
                ) : null}
              </div>
              <div className="studio-live-row__main">
                <div className="studio-live-row__top">
                  <span className="studio-live-row__name">{row.name}</span>
                  <span className="studio-live-row__pct">{row.label}</span>
                </div>
                <div className="studio-live-row__bar">
                  <div className="studio-live-row__fill" style={{ width: `${row.pct}%` }} />
                </div>
              </div>
              {row.cancelId && (
                <button
                  type="button"
                  className="studio-live-row__cancel"
                  onClick={() => handleCancel(row.cancelId!)}
                  disabled={cancellingId === row.cancelId}
                  aria-label="Cancel pack"
                  title="Cancel pack"
                >
                  {cancellingId === row.cancelId ? "Stopping…" : "Cancel"}
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="studio-live__empty">
            Queue is clear. Generate a pack and it renders here live.
          </p>
        )}
      </div>

      <div className="studio-live__divider" />
      <div className="studio-live__finished">
        <div className="studio-live__title studio-live__title--sub">
          {activeRun || showLiveGrids ? "LIVE COPIES" : "JUST FINISHED"}
        </div>

        {showLiveGrids ? (
          runSources.map((source) => (
            <LivePackGrid
              key={source.source_id}
              source={source}
              preparing={preparing}
              upload={upload}
              waking={waking}
            />
          ))
        ) : (
          <p className="studio-live__empty studio-live__empty--sub">
            Finished variants land here, then Open Gallery.
          </p>
        )}
      </div>

      <div className="studio-live__spacer" />

      <Link className="studio-live__gallery" href="/gallery">
        Open Gallery
        <span className="material-symbols-rounded" style={{ fontSize: 17 }}>arrow_forward</span>
      </Link>
    </aside>
  );
}
