"use client";
import { useEffect, useRef, useState } from "react";
import { SourceOut } from "@/lib/types";
import { regenerate, retryCopy, sourceZipUrl, removeSource, getSourceDownloads } from "@/lib/api";
import {
  copyLandingCopy,
  copyMissingCopy,
  deliveryComplete,
  expiresLabel,
  filesReadyCount,
  removePackCopy,
  zipEmptyCopy,
} from "@/lib/gallery";
import { shortfallCopy } from "@/lib/shortfallCopy";
import { jobIsLive } from "@/lib/queue";
import {
  okVariantKeys,
  packActionSelected,
  selectAllLabel,
  selectionHasAllOk,
} from "@/lib/drive";
import {
  fillFileCache,
  filesReadyNow,
  phoneShareHintCopy,
  readyShareableVariants,
  saveOrShareVideoFiles,
  selectedShareableVariants,
  shareEmptyCopy,
  shareOutcomeMessage,
  sharePrepareProgressCopy,
  shareVideosBusyLabel,
  shareVideosLabel,
  shouldOfferPhotosSave,
  zipSecondaryCopy,
  zipVisibleOnDevice,
  type FileCacheProgress,
} from "@/lib/shareVideos";
import { postedCountCopy } from "@/lib/postUrl";
import { packViewsCopy } from "@/lib/instagram";
import { uniquenessCoverageSubcopy, uniquenessCustomerLabel } from "@/lib/prepareCopy";
import { SavePreparePanel } from "./SavePreparePanel";
import { PackOptions } from "./PackOptions";
import { VariantCard } from "./VariantCard";

interface SourceGroupProps {
  source: SourceOut;
  onOpenVariant: (sourceId: string, index: number) => void;
  onRegenerate: () => void;
  selected: Set<string>;
  onToggleVariant: (key: string) => void;
  onToggleSelectSource: (source: SourceOut, select: boolean) => void;
  onRemove: () => void;
}

/**
 * The single active pack's detail panel — grid-pane content to the right of
 * the 300px PACKS list. One pack shown at a time (mock: "Gallery (grid)"),
 * not a stacked accordion of every pack.
 */
export function SourceGroup({
  source, onOpenVariant, onRegenerate, selected, onToggleVariant, onToggleSelectSource,
  onRemove,
}: SourceGroupProps) {
  const [regenLoading, setRegenLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [zipMsg, setZipMsg] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [offerPhotos, setOfferPhotos] = useState(false);
  const [showZip, setShowZip] = useState(true);
  const [pendingShareFiles, setPendingShareFiles] = useState<File[] | null>(null);
  const [prepareProgress, setPrepareProgress] = useState<FileCacheProgress | null>(null);
  const fileCacheRef = useRef(new Map<string, File>());
  const shareLock = useRef(false);

  const hasShortfall = source.shortfall > 0;
  const filesReady = filesReadyCount(source);
  const fullDelivery = deliveryComplete(source);
  const stillRunning = jobIsLive(source.job_state) || !!source.in_flight;
  const shareable = readyShareableVariants(source.variants);
  const actionSelected = packActionSelected(source, selected);
  const actionShareable = selectedShareableVariants([source], actionSelected);
  const canSaveVideos = shareable.length > 0 && !stillRunning;

  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const matchMedia =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia.bind(window)
        : undefined;
    setOfferPhotos(shouldOfferPhotosSave(nav, nav?.userAgent, nav?.maxTouchPoints));
    setShowZip(zipVisibleOnDevice(matchMedia));
  }, []);

  const copyMissing = source.copy_status === "missing" && !stillRunning;
  const copyLanding = source.copy_status === "copying";
  const shortfallMsg = shortfallCopy(source);
  const uniquenessValues = source.variants
    .map((v) => v.uniqueness)
    .filter((u): u is number => typeof u === "number");
  const avgUniquenessPct = uniquenessValues.length
    ? Math.round((uniquenessValues.reduce((a, b) => a + b, 0) / uniquenessValues.length) * 100)
    : null;
  const originalitySummary =
    avgUniquenessPct != null
      ? uniquenessValues.length === 1
        ? `${uniquenessCustomerLabel()} ${avgUniquenessPct}%`
        : `${uniquenessCustomerLabel()} ${avgUniquenessPct}% avg`
      : "";
  const expiresCopy = expiresLabel(source.expires_utc);

  function handleSaveShare() {
    if (stillRunning || shareBusy || shareLock.current || actionShareable.length === 0) return;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const ready = filesReadyNow(fileCacheRef.current, actionShareable, pendingShareFiles);
    setShareBusy(true);
    setZipMsg(null);
    const run = async (files: File[]) => {
      if (files.length === 0) {
        setZipMsg(shareEmptyCopy());
        return;
      }
      const outcome = await saveOrShareVideoFiles(files, {
        share: nav,
        userAgent: nav?.userAgent,
        maxTouchPoints: nav?.maxTouchPoints,
      });
      if (outcome.result === "needs_gesture") {
        setPendingShareFiles(outcome.remaining);
        setZipMsg(shareOutcomeMessage(outcome));
        return;
      }
      setPendingShareFiles(null);
      if (outcome.result === "unsupported") setZipMsg(shareEmptyCopy());
    };
    const task = ready
      ? run(ready)
      : fillFileCache(fileCacheRef.current, actionShareable, undefined, setPrepareProgress).then(run);
    void task.catch(() => setZipMsg(shareEmptyCopy())).finally(() => setShareBusy(false));
  }

  async function handleZip(e: React.MouseEvent) {
    e.preventDefault();
    if (stillRunning) return;
    setZipMsg(null);
    try {
      const pack = await getSourceDownloads(source.source_id);
      const zipUrl = pack.zip_url;
      if (zipUrl) {
        window.location.assign(zipUrl);
        return;
      }
      const files = pack.files || [];
      if (files.length === 0) {
        setZipMsg(zipEmptyCopy());
        return;
      }
      for (const file of files) {
        const a = document.createElement("a");
        a.href = file.url;
        a.download = file.filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      setZipMsg(zipEmptyCopy());
    }
  }

  async function handleRegenerate() {
    if (regenLoading || stillRunning) return;
    setRegenLoading(true);
    try {
      await regenerate(source.source_id, source.shortfall);
      onRegenerate();
    } catch (e) {
      console.error("Regenerate failed", e);
    } finally {
      setRegenLoading(false);
    }
  }

  async function handleRetryCopy() {
    if (copyLoading || stillRunning) return;
    setCopyLoading(true);
    try {
      await retryCopy(source.source_id);
      onRegenerate();
    } catch (e) {
      console.error("Retry delivery failed", e);
    } finally {
      setCopyLoading(false);
    }
  }

  async function handleRemove() {
    if (removing) return;
    if (!window.confirm(removePackCopy(stillRunning))) return;
    setRemoving(true);
    try {
      await removeSource(source.source_id);
      onRemove();
    } catch (err) {
      console.error("Remove failed", err);
      setRemoving(false);
    }
  }

  const okCount = okVariantKeys([source]).length;
  const sourceAllSelected = selectionHasAllOk(selected, [source]);
  const sourceSelectLabel = selectAllLabel(sourceAllSelected);
  const postedCopy = postedCountCopy(source.variants.filter((v) => Boolean(v.post_url)).length);
  const viewsCopy = packViewsCopy(
    source.insights_views,
    source.insights_linked ?? 0,
    source.variants.length,
  );

  return (
    <div className="gallery-pack-panel">
      <div className="gallery-pack-header">
        <span className="gallery-pack-header__name" title={source.filename}>
          {source.filename}
        </span>
        <span
          className="gallery-pack-header__pill"
          data-tone={fullDelivery ? "ok" : "warn"}
        >
          {fullDelivery ? "✓ " : ""}
          {copyMissing
            ? `${filesReady} / ${source.requested} ready`
            : copyLanding
              ? `${filesReady} / ${source.requested} landing`
              : `${filesReady} / ${source.requested} delivered`}
        </span>
        {postedCopy && <span className="gallery-pack-header__meta">{postedCopy}</span>}
        {viewsCopy && <span className="gallery-pack-header__meta">{viewsCopy}</span>}
        {source.processing_charge && (
          <span className="gallery-pack-header__meta">{source.processing_charge}</span>
        )}
        {source.delivery_destination === "google_drive" && (
          <span className="gallery-pack-header__meta">Google Drive</span>
        )}
        {expiresCopy && (
          <span className="gallery-pack-header__meta">{expiresCopy}</span>
        )}
        <div className="gallery-pack-header__actions">
          {okCount > 0 && (
            <button
              type="button"
              className="gallery-pack-header__link"
              onClick={() => onToggleSelectSource(source, !sourceAllSelected)}
            >
              {sourceSelectLabel}
            </button>
          )}
          {canSaveVideos && (
            <button
              type="button"
              className="gallery-pack-header__link"
              title={phoneShareHintCopy()}
              onClick={handleSaveShare}
              disabled={shareBusy}
            >
              {shareBusy
                ? prepareProgress && prepareProgress.ready + prepareProgress.failed < prepareProgress.total
                  ? sharePrepareProgressCopy(prepareProgress)
                  : shareVideosBusyLabel()
                : shareVideosLabel(offerPhotos)}
            </button>
          )}
          {filesReady > 0 && !stillRunning && showZip && (
            <a
              href={sourceZipUrl(source.source_id)}
              download
              title={zipSecondaryCopy()}
              onClick={handleZip}
              className="gallery-zip-link"
            >
              <span className="material-symbols-rounded" aria-hidden="true">folder_zip</span>
              Download ZIP
            </a>
          )}
          <span className="gallery-pack-header__icon-btn source-folder-link" title="Open source folder">
            <span className="material-symbols-rounded" aria-hidden="true">folder_open</span>
          </span>
          <button
            type="button"
            className="gallery-pack-header__icon-btn"
            aria-label="Remove pack from Gallery"
            title="Remove from Gallery"
            onClick={handleRemove}
            disabled={removing}
          >
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      {zipMsg && <div className="gallery-banner">⚠ {zipMsg}</div>}
      {shareBusy && prepareProgress && prepareProgress.total > 0 && (
        <div className="gallery-save-progress-wrap">
          <SavePreparePanel progress={prepareProgress} />
        </div>
      )}
      {copyMissing && (
        <div className="gallery-banner">
          ⚠ {copyMissingCopy()}
          <button type="button" onClick={handleRetryCopy} disabled={copyLoading}>
            {copyLoading ? "Retrying…" : "↻ Retry delivery"}
          </button>
        </div>
      )}
      {copyLanding && !copyMissing && (
        <div className="gallery-banner">{copyLandingCopy()}</div>
      )}
      {hasShortfall && shortfallMsg && (
        <div className="gallery-banner">
          ⚠ {shortfallMsg}
          {!stillRunning && (
            <button type="button" onClick={handleRegenerate} disabled={regenLoading}>
              {regenLoading ? "Regenerating…" : `↻ Regenerate ${source.shortfall}`}
            </button>
          )}
        </div>
      )}

      <div className="gallery-summary-row">
        <div>
          <div className="gallery-summary-row__eyebrow">Review library</div>
          <div className="gallery-summary-row__title">
            {source.variants.length} variant{source.variants.length === 1 ? "" : "s"}
            {originalitySummary ? (
              <>
                {" · "}
                <span title={uniquenessCoverageSubcopy()}>{originalitySummary}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <PackOptions source={source} disabled={stillRunning} onRewritten={onRegenerate} />

      {source.variants.length === 0 ? (
        <div className="gallery-empty">
          <strong>No variants in this pack yet</strong>
        </div>
      ) : (
        <div className="gallery-grid">
          {source.variants.map((variant) => {
            const key = `${source.source_id}:${variant.index}`;
            return (
              <VariantCard
                key={variant.index}
                variant={variant}
                sourceId={source.source_id}
                onOpen={() => onOpenVariant(source.source_id, variant.index)}
                selected={selected.has(key)}
                onToggle={() => onToggleVariant(key)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
