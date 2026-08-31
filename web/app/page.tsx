"use client";
import { useState, useCallback } from "react";
import { FolderOpen } from "lucide-react";
import { DropZone } from "@/components/studio/DropZone";
import { FileList } from "@/components/studio/FileList";
import { DrivePickList } from "@/components/studio/DrivePickList";
import { DrivePickerModal, type DrivePick } from "@/components/studio/DrivePickerModal";
import { VariantStepper } from "@/components/studio/VariantStepper";
import { GenerateButton } from "@/components/studio/GenerateButton";
import { AdvancedPanel } from "@/components/studio/AdvancedPanel";
import { StudioCaptionsBox } from "@/components/studio/StudioCaptionsBox";
import { StudioQueue } from "@/components/studio/StudioQueueLive";
import { ProgressPanel } from "@/components/studio/ProgressPanel";
import { readDurations, tooLargeMessage, totalVariants } from "@/lib/files";
import { DEFAULT_PER_VIDEO, MAX_PER_VIDEO } from "@/lib/variantStepperCopy";
import { createJob, createJobFromDrive } from "@/lib/api";
import { useRun } from "@/lib/runStore";
import { useAuthMe } from "@/lib/useAuthMe";
import { isAgencyExperience } from "@/lib/experience";
import { studioProgressIdleClass, studioShellClass } from "@/lib/studioLayout";

export default function StudioPage() {
  const { start, beginPrepare, clear, jobId, complete } = useRun();
  const { data: me } = useAuthMe();
  const agency = isAgencyExperience(me);
  const [files, setFiles] = useState<File[]>([]);
  const [durations, setDurations] = useState<number[]>([]);
  const [drivePicks, setDrivePicks] = useState<DrivePick[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [perVideo, setPerVideo] = useState(DEFAULT_PER_VIDEO);
  const [allowCreativeEscalate, setAllowCreativeEscalate] = useState(true);
  const [qualityMode, setQualityMode] = useState<"fast" | "hq">("fast");
  const [generateCaptions, setGenerateCaptions] = useState(false);
  const [captionPrompt, setCaptionPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceCount = files.length + drivePicks.length;
  const driveDestinationId = drivePicks[0]?.destinationId ?? null;

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
  }, []);

  function handleRemoveFile(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      readDurations(next).then(setDurations);
      return next;
    });
  }

  function handleRemoveDrivePick(index: number) {
    setDrivePicks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDriveConfirm(picks: DrivePick[]) {
    if (picks.length === 0) return;
    const destId = picks[0].destinationId;
    setDrivePicks((prev) => {
      if (prev.length === 0 || prev[0].destinationId !== destId) return picks;
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of picks) byId.set(p.id, p);
      return Array.from(byId.values());
    });
    setError(null);
  }

  async function handleGenerate() {
    if (busy || sourceCount === 0) return;
    if (jobId && !complete) return;
    if (files.length > 0 && drivePicks.length > 0) {
      setError("Use either phone files or Drive clips in one run — not both.");
      return;
    }
    setError(null);
    const names = files.length > 0
      ? files.map((f) => f.name)
      : drivePicks.map((p) => p.name);
    beginPrepare(names.map((filename, i) => ({
      source_id: `prep-${i}`,
      filename,
      requested: perVideo,
    })));
    setBusy(true);
    try {
      const resp =
        drivePicks.length > 0
          ? await createJobFromDrive({
              destinationId: drivePicks[0].destinationId,
              fileIds: drivePicks.map((p) => p.id),
              count: perVideo,
              qualityMode: "fast",
              allowCreativeEscalate,
              generateCaptions,
              captionPrompt,
            })
          : await createJob(files, perVideo, allowCreativeEscalate, "fast", generateCaptions, captionPrompt);
      start(resp, "fast");
    } catch (e) {
      clear();
      setError(e instanceof Error ? e.message : "Job failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={studioShellClass(!!jobId)}>
      <div className="studio-cockpit">
        <header className="studio-intro">
          <p>Studio</p>
          <h1>Build a new pack</h1>
          <span>Choose source clips, set the output count, then track the live queue without leaving this workspace.</span>
        </header>
        <p className="studio-step-label">1 · Source videos</p>

        <StudioQueue qualityMode={qualityMode} jobId={jobId} />

        <DropZone onFiles={handleFiles} />

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={Boolean(jobId && !complete)}
          className="studio-drive-picker"
        >
          <FolderOpen size={16} /> Pick from Google Drive
        </button>

        <FileList files={files} durations={durations} onRemove={handleRemoveFile} />
        <DrivePickList picks={drivePicks} onRemove={handleRemoveDrivePick} />

        <div className="studio-actions">
          <VariantStepper
            value={perVideo}
            onChange={setPerVideo}
            min={1}
            max={MAX_PER_VIDEO}
            fileCount={sourceCount}
            qualityMode={qualityMode}
          />
          <GenerateButton
            fileCount={sourceCount}
            perVideo={perVideo}
            onClick={handleGenerate}
            disabled={Boolean(jobId && !complete)}
            busy={busy}
            jobId={jobId}
            complete={complete}
          />
        </div>

        <StudioCaptionsBox
          generateCaptions={generateCaptions}
          onGenerateCaptionsChange={setGenerateCaptions}
          captionPrompt={captionPrompt}
          onCaptionPromptChange={setCaptionPrompt}
        />

        {error && (
          <div className="vf-alert vf-alert--error" style={{ marginTop: 12, marginBottom: 0 }}>
            {error}
          </div>
        )}

        {agency && (
          <AdvancedPanel
            allowCreativeEscalate={allowCreativeEscalate}
            onAllowCreativeEscalateChange={setAllowCreativeEscalate}
            qualityMode={qualityMode}
            onQualityModeChange={setQualityMode}
            totalVariants={totalVariants(sourceCount, perVideo)}
          />
        )}
      </div>

      <div className={studioProgressIdleClass(!!jobId)}>
        <ProgressPanel />
      </div>

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
