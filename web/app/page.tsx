"use client";
import { useState, useCallback, useRef, DragEvent } from "react";
import { FileList } from "@/components/studio/FileList";
import { DrivePickList } from "@/components/studio/DrivePickList";
import { DrivePickerModal, type DrivePick } from "@/components/studio/DrivePickerModal";
import { VariantStepper } from "@/components/studio/VariantStepper";
import { GenerateButton } from "@/components/studio/GenerateButton";
import { AdvancedPanel } from "@/components/studio/AdvancedPanel";
import { StudioCaptionsBox, type CaptionSource } from "@/components/studio/StudioCaptionsBox";
import { StudioLiveQueue } from "@/components/studio/StudioLiveQueue";
import { accepts, readDurations, tooLargeMessage, totalVariants } from "@/lib/files";
import { DEFAULT_PER_VIDEO, MAX_PER_VIDEO } from "@/lib/variantStepperCopy";
import { createJob, createJobFromDrive, cancelJob } from "@/lib/api";
import { useRun } from "@/lib/runStore";
import { useAuthMe } from "@/lib/useAuthMe";
import { isAgencyExperience } from "@/lib/experience";
import { studioShellClass } from "@/lib/studioLayout";
import { studioCaptionSources } from "@/lib/studioCaptionSources";
import { hqPrepToggleHint, hqPrepToggleLabel, isPreparingJob, preparingSubcopy, wakingSubcopy } from "@/lib/prepareCopy";
import { uploadBusyTitle, uploadProgressCopy } from "@/lib/jobUpload";
import { runHasStarted } from "@/lib/progress";
import { useElapsedSeconds } from "@/lib/useElapsedSeconds";

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.max(1, Math.round(mb))} MB`;
}

export default function StudioPage() {
  const { start, beginPrepare, clear, jobId, complete, setUpload, upload, waitStartedAt, progress } = useRun();
  const { data: me } = useAuthMe();
  const agency = isAgencyExperience(me);
  const [files, setFiles] = useState<File[]>([]);
  const [durations, setDurations] = useState<number[]>([]);
  const [drivePicks, setDrivePicks] = useState<DrivePick[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [perVideo, setPerVideo] = useState(DEFAULT_PER_VIDEO);
  const [allowCreativeEscalate, setAllowCreativeEscalate] = useState(true);
  const [qualityMode, setQualityMode] = useState<"fast" | "hq">("fast");
  const [hqPrep, setHqPrep] = useState(false);
  const [generateCaptions, setGenerateCaptions] = useState(false);
  const [fileCaptions, setFileCaptions] = useState<string[]>([]);
  const [driveCaptions, setDriveCaptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelRequestedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sourceCount = files.length + drivePicks.length;
  const driveDestinationId = drivePicks[0]?.destinationId ?? null;
  const jobRunning = Boolean(jobId && !complete);
  const preparing = isPreparingJob(jobId);
  const waking = jobRunning && !preparing && !runHasStarted(progress);
  const elapsed = useElapsedSeconds(busy || jobRunning, waitStartedAt);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const sizeLabel = formatSize(totalBytes);
  const sourceMeta =
    sourceCount > 0
      ? `${sourceCount} clip${sourceCount !== 1 ? "s" : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`
      : "No clips yet";

  const prepMode = hqPrep ? "hq" : "none";
  const captionSources: CaptionSource[] = studioCaptionSources(files, drivePicks);
  const captionPrompts = [...fileCaptions, ...driveCaptions];

  const handleFiles = useCallback(async (incoming: File[]) => {
    const blocked = incoming.map(tooLargeMessage).find(Boolean);
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setFiles((prev) => {
      const combined = [...prev, ...incoming];
      readDurations(combined).then(setDurations);
      return combined;
    });
    setFileCaptions((prev) => [...prev, ...incoming.map(() => "")]);
  }, []);

  function clearSourceDraft() {
    setFiles([]);
    setDurations([]);
    setDrivePicks([]);
    setFileCaptions([]);
    setDriveCaptions([]);
    setGenerateCaptions(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function acceptDropped(list: FileList | null) {
    const picked = Array.from(list ?? []).filter(accepts);
    if (picked.length) handleFiles(picked);
  }

  function handleTileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptDropped(event.dataTransfer.files);
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      readDurations(next).then(setDurations);
      return next;
    });
    setFileCaptions((prev) => prev.filter((_, i) => i !== index));
  }

  function handleRemoveDrivePick(index: number) {
    setDrivePicks((prev) => prev.filter((_, i) => i !== index));
    setDriveCaptions((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDriveConfirm(picks: DrivePick[]) {
    if (picks.length === 0) return;
    const destId = picks[0].destinationId;
    setDrivePicks((prev) => {
      if (prev.length === 0 || prev[0].destinationId !== destId) {
        setDriveCaptions(picks.map(() => ""));
        return picks;
      }
      const byId = new Map(prev.map((p) => [p.id, p]));
      const captionsById = new Map(prev.map((p, i) => [p.id, driveCaptions[i] ?? ""]));
      for (const p of picks) byId.set(p.id, p);
      const next = Array.from(byId.values());
      setDriveCaptions(next.map((p) => captionsById.get(p.id) ?? ""));
      return next;
    });
    setError(null);
  }

  function handleCaptionChange(index: number, value: string) {
    if (index < files.length) {
      setFileCaptions((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
      return;
    }
    const driveIndex = index - files.length;
    setDriveCaptions((prev) => {
      const next = [...prev];
      next[driveIndex] = value;
      return next;
    });
  }

  async function handleGenerate() {
    if (busy || sourceCount === 0) return;
    if (jobId && !complete) return;
    if (files.length > 0 && drivePicks.length > 0) {
      setError("Use either phone files or Drive clips in one run — not both.");
      return;
    }
    setError(null);
    cancelRequestedRef.current = false;
    const sendFiles = files;
    const sendPicks = drivePicks;
    const sendFileCaptions = fileCaptions;
    const sendDriveCaptions = driveCaptions;
    const sendGenerateCaptions = generateCaptions;
    const names = sendFiles.length > 0
      ? sendFiles.map((f) => f.name)
      : sendPicks.map((p) => p.name);
    beginPrepare(names.map((filename, i) => ({
      source_id: `prep-${i}`,
      filename,
      requested: perVideo,
    })));
    clearSourceDraft();
    setBusy(true);
    try {
      const resp =
        sendPicks.length > 0
          ? await createJobFromDrive({
              destinationId: sendPicks[0].destinationId,
              fileIds: sendPicks.map((p) => p.id),
              count: perVideo,
              qualityMode: "fast",
              allowCreativeEscalate,
              generateCaptions: sendGenerateCaptions,
              prepMode,
              captionPrompt: sendDriveCaptions,
              onProgress: setUpload,
            })
          : await createJob(sendFiles, perVideo, allowCreativeEscalate, "fast", sendGenerateCaptions, prepMode, sendFileCaptions, setUpload);
      if (cancelRequestedRef.current) {
        try {
          await cancelJob(resp.job_id);
        } catch {
          /* pack may already have stopped */
        }
        clear();
        return;
      }
      start(resp, "fast", prepMode);
    } catch (e) {
      setFiles(sendFiles);
      setDrivePicks(sendPicks);
      setFileCaptions(sendFileCaptions);
      setDriveCaptions(sendDriveCaptions);
      setGenerateCaptions(sendGenerateCaptions);
      readDurations(sendFiles).then(setDurations);
      clear();
      setError(e instanceof Error ? e.message : "Job failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPack() {
    if (cancelling) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    const id = jobId && !isPreparingJob(jobId) ? jobId : null;
    try {
      if (id) await cancelJob(id);
    } catch {
      /* poll drops the row once the job closes */
    } finally {
      clear();
      setBusy(false);
      setCancelling(false);
    }
  }

  return (
    <main className={studioShellClass(!!jobId)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          acceptDropped(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="studio-cockpit">
        <div className="studio-cockpit__scroll">
          <div className="studio-cockpit__inner">
            <header className="studio-intro">
              <p>Studio</p>
              <h1>Build a pack</h1>
              <span>Pick clips, set variants, then Generate. Live Queue sits at the bottom.</span>
            </header>

            <section className="studio-section">
              <div className="studio-section__head">
                <p className="studio-eyebrow">01 · Source</p>
                <span className="studio-section__meta">{sourceMeta}</span>
              </div>

              <div className="studio-source-grid">
                <FileList files={files} durations={durations} onRemove={handleRemoveFile} />
                <DrivePickList picks={drivePicks} onRemove={handleRemoveDrivePick} />
                <div
                  className="studio-drop-tile"
                  data-dragging={dragging}
                  onClick={openPicker}
                  onDrop={handleTileDrop}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  role="button"
                  tabIndex={0}
                  aria-label="Add or drop videos"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPicker();
                    }
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 20 }}>add</span>
                  <span className="studio-drop-tile__label">DROP OR ADD</span>
                </div>
              </div>

              <div className="studio-source-actions">
                <button
                  type="button"
                  className="studio-upload-btn"
                  onClick={openPicker}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>upload_file</span>
                  Upload files
                </button>
                <button
                  type="button"
                  className="studio-drive-picker"
                  onClick={() => setPickerOpen(true)}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>cloud</span>
                  From Drive
                </button>
                <span className="studio-source-hint">MP4 / MOV · up to 1 GB each</span>
              </div>
            </section>

            <hr className="studio-divider" />

            <section className="studio-section">
              <p className="studio-eyebrow">02 · Variants per clip</p>
              <VariantStepper
                value={perVideo}
                onChange={setPerVideo}
                min={1}
                max={MAX_PER_VIDEO}
              />
            </section>

            <hr className="studio-divider" />

            <section className="studio-section studio-section--options">
              <p className="studio-eyebrow">03 · Options</p>
              <div className="studio-options">
                <StudioCaptionsBox
                  generateCaptions={generateCaptions}
                  onGenerateCaptionsChange={setGenerateCaptions}
                  sources={captionSources}
                  prompts={captionPrompts}
                  onPromptChange={handleCaptionChange}
                />

                <label
                  className="studio-option-row studio-caption-toggle"
                  data-testid="hq-prep-toggle"
                >
                  <div>
                    <div className="studio-option-row__label">{hqPrepToggleLabel()}</div>
                    <div className="studio-option-row__hint">{hqPrepToggleHint()}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={hqPrep}
                    onChange={(e) => setHqPrep(e.target.checked)}
                  />
                  <span className="studio-switch" data-on={hqPrep} aria-hidden="true">
                    <span className="studio-switch__thumb" />
                  </span>
                </label>

                <div className="studio-option-row studio-option-row--static">
                  <span className="studio-option-row__label">Output size</span>
                  <span className="studio-option-row__value">
                    Matches source
                    <span className="material-symbols-rounded studio-option-row__chevron">chevron_right</span>
                  </span>
                </div>

                {agency ? (
                  <AdvancedPanel
                    allowCreativeEscalate={allowCreativeEscalate}
                    onAllowCreativeEscalateChange={setAllowCreativeEscalate}
                    qualityMode={qualityMode}
                    onQualityModeChange={setQualityMode}
                    totalVariants={totalVariants(sourceCount, perVideo)}
                  />
                ) : (
                  <div className="studio-option-row studio-option-row--static studio-option-row--last">
                    <span className="studio-option-row__label">Advanced</span>
                    <span className="studio-option-row__value">
                      Defaults
                      <span className="material-symbols-rounded studio-option-row__chevron">chevron_right</span>
                    </span>
                  </div>
                )}
              </div>
            </section>

            {error && (
              <div className="vf-alert vf-alert--error" style={{ margin: 0 }}>
                {error}
              </div>
            )}

            <div className="studio-cockpit__spacer" />
          </div>
        </div>

        <div className="studio-generate-bar studio-generate-bar--dock" data-testid="studio-generate-dock">
          <div className="studio-generate-bar__inner">
            <GenerateButton
              fileCount={sourceCount}
              perVideo={perVideo}
              onClick={handleGenerate}
              disabled={jobRunning}
              busy={busy}
              jobId={jobId}
              complete={complete}
              onCancel={jobRunning || busy ? handleCancelPack : undefined}
              cancelling={cancelling}
              title={
                uploadBusyTitle(upload)
                ?? (preparing ? "Starting…" : waking ? "Waking…" : undefined)
              }
              detail={
                upload
                  ? uploadProgressCopy(upload)
                  : preparing
                    ? preparingSubcopy(elapsed)
                    : waking
                      ? wakingSubcopy(elapsed, progress.waitPhase)
                      : undefined
              }
            />
          </div>
        </div>
      </div>

      <StudioLiveQueue />

      {pickerOpen && (
        <DrivePickerModal
          existingDestinationId={driveDestinationId}
          onConfirm={handleDriveConfirm}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </main>
  );
}
