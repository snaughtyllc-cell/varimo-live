"use client";
import { useState } from "react";
import { useRun } from "@/lib/runStore";
import { cancelJob } from "@/lib/api";
import { runDeliveredNone, runHasStarted } from "@/lib/progress";
import { liveRunSubcopy, reconstructFirstHeadline, reconstructFirstSubcopy } from "@/lib/hqWaitCopy";
import {
  isPreparingJob,
  preparingHeadline,
  preparingSubcopy,
  wakingHeadline,
  wakingSubcopy,
} from "@/lib/prepareCopy";
import { useElapsedSeconds } from "@/lib/useElapsedSeconds";
import { SourceProgressCard } from "./SourceProgressCard";

export function ProgressPanel() {
  const { jobId, progress, complete, clear, qualityMode, prepMode, waitStartedAt } = useRun();
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (!jobId || complete || cancelling) return;
    setCancelling(true);
    try {
      await cancelJob(jobId);
    } catch {
      // Poll will still close the job; keep the button from double-firing.
    }
  }

  // Empty state — no job running
  if (!jobId) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "0 32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "#16272c",
            border: "1px solid #24393f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            marginBottom: 4,
          }}
        >
          <span style={{ color: "var(--color-cyan)" }}>●</span>
        </div>
        <p
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#eaf6f7",
            margin: 0,
          }}
        >
          No run in progress
        </p>
        <p
          style={{
            fontSize: 12,
            color: "#7e979d",
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 200,
          }}
        >
          Add a video and Generate — live tiles show here
        </p>
      </div>
    );
  }

  const sources = Object.values(progress.bySource);
  const preparing = isPreparingJob(jobId);
  const started = runHasStarted(progress);
  const early = !complete && !progress.failed && (preparing || !started);
  const waking = Boolean(early && !preparing && prepMode !== "hq");
  const elapsed = useElapsedSeconds(early, waitStartedAt);
  const reconstructing = Boolean(prepMode === "hq" && !started && !complete && !preparing && !progress.failed);
  const emptyFail = runDeliveredNone(progress);
  const failed = progress.failed;
  const cancelled = Boolean(failed && /cancelled/i.test(failed));
  const headline = reconstructing
    ? reconstructFirstHeadline()
    : waking
    ? wakingHeadline()
    : early
    ? preparingHeadline()
    : failed
      ? cancelled
        ? "Cancelled"
        : "Run lost"
      : complete
        ? emptyFail
          ? "No variants"
          : "Complete"
        : "Generating…";
  const sub = reconstructing
    ? reconstructFirstSubcopy()
    : waking
    ? wakingSubcopy(elapsed, progress.waitPhase)
    : early
    ? preparingSubcopy(elapsed)
    : failed
      ? failed
      : complete
        ? emptyFail
          ? "The job ended without any playable variants. Try a smaller 1080p file."
          : "All variants done — open Gallery, or New run for another pack"
        : liveRunSubcopy(qualityMode, prepMode ?? "none");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexShrink: 0,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#eaf6f7" }}>
            {headline}
          </div>
          <div style={{ fontSize: 11.5, color: "#7e979d", marginTop: 2, maxWidth: "100%", lineHeight: 1.4 }}>
            {sub}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {jobId && !complete && !preparing && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                background: "rgba(229, 83, 61, 0.14)",
                border: "1px solid rgba(229, 83, 61, 0.4)",
                color: "var(--color-red)",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 13,
                minHeight: 44,
                cursor: cancelling ? "wait" : "pointer",
              }}
            >
              {cancelling ? "Stopping…" : "Cancel"}
            </button>
          )}
          {jobId && (
            <button
              type="button"
              className="studio-progress-newrun"
              onClick={clear}
              style={{
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 700,
                minHeight: 44,
                cursor: "pointer",
              }}
            >
              New run
            </button>
          )}
          <span
            className="studio-progress-pill"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11.5,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: complete ? "var(--color-green)" : "var(--color-cyan)",
                boxShadow: complete
                  ? "0 0 8px rgba(18, 183, 106, 0.5)"
                  : "0 0 8px rgba(126, 224, 230, 0.55)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {early ? (waking ? "waking" : "starting") : complete ? "done" : "live"}
          </span>
        </div>
      </div>

      {/* Source cards — scrollable */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {sources.map((source) => (
          <SourceProgressCard
            key={source.source_id}
            source={source}
            qualityMode={qualityMode}
            complete={complete}
            preparing={early}
            waking={waking}
          />
        ))}
      </div>
    </div>
  );
}
