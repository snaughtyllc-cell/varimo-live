"use client";
import type { QueueSnapshot } from "@/lib/types";
import { queueHeadline, queueRowLabel, queueWaitCopy, jobIsLive } from "@/lib/queue";

export function StudioQueueCard({
  queue,
  qualityMode,
  jobId,
  onCancel,
  cancellingId,
}: {
  queue: QueueSnapshot;
  qualityMode: "fast" | "hq";
  jobId?: string | null;
  onCancel?: (jobId: string) => void;
  cancellingId?: string | null;
}) {
  return (
    <div
      style={{
        margin: "0 0 14px",
        padding: "10px 12px",
        background: "var(--color-panel2)",
        border: "1px solid var(--color-line)",
        borderRadius: 10,
        fontSize: 12,
        lineHeight: 1.45,
        color: "var(--color-muted)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".5px",
          textTransform: "uppercase",
          color: "var(--color-muted2)",
          marginBottom: 6,
        }}
      >
        {queueHeadline(queue)}
      </div>
      {queue.jobs.length > 0 && (
        <ul style={{ margin: "0 0 8px", padding: "0 0 0 0", listStyle: "none" }}>
          {queue.jobs.map((job) => {
            const mine = job.job_id === jobId;
            const stopping = cancellingId === job.job_id;
            return (
              <li
                key={job.job_id}
                style={{
                  margin: "0 0 4px",
                  color: mine ? "var(--color-text)" : "var(--color-muted)",
                  fontWeight: mine ? 650 : 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  {queueRowLabel(job)}
                  {mine ? " · you" : ""}
                </span>
                {onCancel && jobIsLive(job.state) && job.state !== "cancel_requested" && (
                  <button
                    type="button"
                    onClick={() => onCancel(job.job_id)}
                    disabled={stopping}
                    style={{
                      background: "#fff3f1",
                      border: "1px solid #efc5c0",
                      color: "var(--color-red)",
                      borderRadius: 7,
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: stopping ? "wait" : "pointer",
                    }}
                  >
                    {stopping ? "Stopping…" : "Cancel"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p style={{ margin: 0 }}>{queueWaitCopy(queue, qualityMode, jobId)}</p>
    </div>
  );
}
