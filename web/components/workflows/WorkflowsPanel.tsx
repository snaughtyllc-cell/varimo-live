"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  createWorkflow,
  deleteWorkflow,
  getDriveStatus,
  listCaptionBanks,
  listDestinations,
  listWorkflows,
  runWorkflow,
  updateWorkflow,
  cancelWorkflow,
} from "@/lib/api";
import type { CaptionBankFolder, Destination, DriveStatus, Workflow, WorkflowSummary } from "@/lib/types";
import { captionFolderSelectLabel } from "@/lib/captions";
import { DEFAULT_PER_VIDEO, MAX_PER_VIDEO } from "@/lib/variantStepperCopy";
import {
  workflowFoldersClash,
  workflowFoldersMustDiffer,
  workflowInboxHint,
  workflowNeedTwoFolders,
  workflowOutputHint,
  workflowAutoCaptionHint,
  workflowCanCancel,
  workflowFilenameCaptionHint,
  workflowFilenameCaptionLabel,
  workflowFilenameCaptionCardLabel,
} from "@/lib/workflowCopy";

const DEFAULT_POLL_MINUTES = 2;
const MAX_POLL_MINUTES = 60;

function destName(destinations: Destination[], id: string): string {
  return destinations.find((d) => d.id === id)?.name ?? id;
}

function bankLabel(banks: CaptionBankFolder[], bankId: string | null | undefined): string {
  const selected = banks.find((b) => b.id === bankId) ?? banks.find((b) => b.is_default);
  if (!selected) return "Generic";
  return captionFolderSelectLabel(selected.name, selected.count, selected.remaining);
}

function formatSummary(summary: WorkflowSummary | null): string {
  if (!summary) return "No runs yet";
  const parts = [
    summary.queued ? `${summary.queued} queued` : null,
    summary.running ? `${summary.running} running` : null,
    summary.exported ? `${summary.exported} exported` : null,
    summary.skipped ? `${summary.skipped} skipped` : null,
    summary.failed ? `${summary.failed} failed` : null,
  ].filter(Boolean);
  if (summary.error) parts.push(summary.error);
  return parts.length ? parts.join(" · ") : "Sweep complete — nothing new";
}

export function WorkflowsPanel() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [outputId, setOutputId] = useState("");
  const [count, setCount] = useState(DEFAULT_PER_VIDEO);
  const [qualityMode, setQualityMode] = useState<"fast" | "hq">("fast");
  const [pollMinutes, setPollMinutes] = useState(DEFAULT_POLL_MINUTES);
  const [enabled, setEnabled] = useState(true);
  const [autoCaption, setAutoCaption] = useState(false);
  const [captionFromFilename, setCaptionFromFilename] = useState(false);
  const [captionBankId, setCaptionBankId] = useState("");
  const [banks, setBanks] = useState<CaptionBankFolder[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [actionId, setActionId] = useState<string | null>(null);

  const driveNotReady = status != null && status.status !== "ready";

  async function refresh() {
    setLoading(true);
    try {
      const [s, d, w, b] = await Promise.all([
        getDriveStatus(),
        listDestinations(),
        listWorkflows(),
        listCaptionBanks().catch(() => [] as CaptionBankFolder[]),
      ]);
      setStatus(s);
      setDestinations(d);
      setWorkflows(w);
      setBanks(b);
      if (!captionBankId) {
        const generic = b.find((x) => x.is_default) ?? b[0];
        if (generic) setCaptionBankId(generic.id);
      }
      const inboxDest = d.find((x) => x.id === inboxId) ?? d[0];
      if (inboxDest && !inboxId) setInboxId(inboxDest.id);
      if (!outputId && inboxDest) {
        const other = d.find((x) => !workflowFoldersClash(inboxDest, x));
        if (other) setOutputId(other.id);
      }
    } catch (e) {
      console.error("Failed to load workflows", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || driveNotReady || destinations.length < 2) return;
    if (!name.trim() || !inboxId || !outputId) {
      setFormError("Name, inbox folder, and output folder are required.");
      return;
    }
    const inboxDest = destinations.find((d) => d.id === inboxId);
    const outDest = destinations.find((d) => d.id === outputId);
    if (!inboxDest || !outDest || workflowFoldersClash(inboxDest, outDest)) {
      setFormError(workflowFoldersMustDiffer());
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createWorkflow({
        name: name.trim(),
        inbox_destination_id: inboxId,
        output_destination_id: outputId,
        count,
        quality_mode: qualityMode,
        enabled,
        poll_seconds: Math.round(pollMinutes * 60),
        auto_caption: autoCaption,
        caption_bank_id: captionBankId || null,
        caption_from_filename: captionFromFilename,
      });
      setWorkflows((prev) => [...prev, created]);
      setName("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create workflow");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleEnabled(wf: Workflow) {
    setActionId(wf.id);
    try {
      const updated = await updateWorkflow(wf.id, { enabled: !wf.enabled });
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to toggle workflow", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleToggleAutoCaption(wf: Workflow) {
    setActionId(wf.id);
    try {
      const next = !wf.auto_caption;
      const updated = await updateWorkflow(wf.id, {
        auto_caption: next,
        caption_from_filename: next ? false : Boolean(wf.caption_from_filename),
      });
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to toggle auto-caption", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleToggleFilenameCaption(wf: Workflow) {
    setActionId(wf.id);
    try {
      const next = !wf.caption_from_filename;
      const updated = await updateWorkflow(wf.id, {
        caption_from_filename: next,
        auto_caption: next ? false : wf.auto_caption,
      });
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to toggle filename captions", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleCaptionBank(wf: Workflow, nextBankId: string) {
    setActionId(wf.id);
    try {
      const updated = await updateWorkflow(wf.id, { caption_bank_id: nextBankId || null });
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to set caption folder", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleRun(wf: Workflow) {
    setActionId(wf.id);
    try {
      const updated = await runWorkflow(wf.id);
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to run workflow", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleCancel(wf: Workflow) {
    setActionId(wf.id);
    try {
      const updated = await cancelWorkflow(wf.id);
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? updated : x)));
    } catch (err) {
      console.error("Failed to cancel workflow", err);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(wf: Workflow) {
    if (!window.confirm(`Delete workflow "${wf.name}"?`)) return;
    setActionId(wf.id);
    try {
      await deleteWorkflow(wf.id);
      setWorkflows((prev) => prev.filter((x) => x.id !== wf.id));
    } catch (err) {
      console.error("Failed to delete workflow", err);
    } finally {
      setActionId(null);
    }
  }

  return (
    <div>
      {driveNotReady && status && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            background: "#fff8eb",
            border: "1px solid #efdfbd",
            borderRadius: 12,
            fontSize: 12.5,
            color: "#8e6119",
          }}
        >
          <div>{status.message}</div>
          <Link href="/settings/drive" style={{ color: "var(--color-text)", fontWeight: 600 }}>
            Settings → Drive
          </Link>
        </div>
      )}

      {!loading && destinations.length === 0 && (
        <div
          style={{
            padding: "14px 16px",
            marginBottom: 18,
            border: "1px dashed var(--color-line2)",
            borderRadius: 12,
            color: "var(--color-muted)",
            fontSize: 12.5,
            background: "#0d0d13",
          }}
        >
          Add Drive folders in{" "}
          <Link href="/settings/drive" style={{ color: "var(--color-text)", fontWeight: 600 }}>
            Settings → Drive
          </Link>{" "}
          before creating a workflow.
        </div>
      )}

      {!loading && destinations.length === 1 && (
        <div
          style={{
            padding: "14px 16px",
            marginBottom: 18,
            border: "1px dashed var(--color-line2)",
            borderRadius: 12,
            color: "var(--color-muted)",
            fontSize: 12.5,
            background: "#0d0d13",
          }}
        >
          {workflowNeedTwoFolders()}{" "}
          <Link href="/settings/drive" style={{ color: "var(--color-text)", fontWeight: 600 }}>
            Settings → Drive
          </Link>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          padding: 16,
          marginBottom: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>New workflow</div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Reels inbox"
            required
            disabled={destinations.length === 0 || driveNotReady}
            style={inputStyle(destinations.length === 0 || driveNotReady)}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Inbox folder</span>
          <select
            value={inboxId}
            onChange={(e) => {
              const next = e.target.value;
              setInboxId(next);
              const inboxDest = destinations.find((d) => d.id === next);
              const outDest = destinations.find((d) => d.id === outputId);
              if (inboxDest && outDest && workflowFoldersClash(inboxDest, outDest)) {
                const other = destinations.find((d) => !workflowFoldersClash(inboxDest, d));
                setOutputId(other?.id ?? "");
              }
            }}
            disabled={destinations.length === 0 || driveNotReady}
            style={inputStyle(destinations.length === 0 || driveNotReady)}
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--color-muted2)" }}>{workflowInboxHint()}</span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Output folder</span>
          <select
            value={outputId}
            onChange={(e) => setOutputId(e.target.value)}
            disabled={destinations.length === 0 || driveNotReady}
            style={inputStyle(destinations.length === 0 || driveNotReady)}
          >
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--color-muted2)" }}>{workflowOutputHint()}</span>
        </label>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--color-text)" }}>
          <input
            type="checkbox"
            checked={captionFromFilename}
            onChange={(e) => {
              const on = e.target.checked;
              setCaptionFromFilename(on);
              if (on) setAutoCaption(false);
            }}
            disabled={destinations.length === 0 || driveNotReady}
            style={{ accentColor: "#0caab8", marginTop: 2 }}
          />
          <span>
            {workflowFilenameCaptionLabel()}
            <span style={{ display: "block", fontSize: 11, color: "var(--color-muted2)", marginTop: 2 }}>
              {workflowFilenameCaptionHint()}
            </span>
          </span>
        </label>

        {captionFromFilename ? null : (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--color-text)" }}>
          <input
            type="checkbox"
            checked={autoCaption}
            onChange={(e) => {
              const on = e.target.checked;
              setAutoCaption(on);
              if (on) setCaptionFromFilename(false);
            }}
            disabled={destinations.length === 0 || driveNotReady}
            style={{ accentColor: "#0caab8", marginTop: 2 }}
          />
          <span>
            Auto-caption from bank
            <span style={{ display: "block", fontSize: 11, color: "var(--color-muted2)", marginTop: 2 }}>
              {workflowAutoCaptionHint()}
            </span>
          </span>
        </label>
        )}

        {banks.length > 0 && !captionFromFilename && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Caption folder</span>
            <select
              value={captionBankId}
              onChange={(e) => setCaptionBankId(e.target.value)}
              disabled={destinations.length === 0 || driveNotReady}
              style={inputStyle(destinations.length === 0 || driveNotReady)}
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {captionFolderSelectLabel(b.name, b.count, b.remaining)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 120px" }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Variants per clip</span>
            <input
              type="number"
              min={1}
              max={MAX_PER_VIDEO}
              value={count}
              onChange={(e) => setCount(Math.min(MAX_PER_VIDEO, Math.max(1, Number(e.target.value) || 1)))}
              disabled={destinations.length === 0 || driveNotReady}
              style={inputStyle(destinations.length === 0 || driveNotReady)}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 120px" }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Quality</span>
            <select
              value="fast"
              onChange={() => setQualityMode("fast")}
              disabled={destinations.length === 0 || driveNotReady}
              style={inputStyle(destinations.length === 0 || driveNotReady)}
            >
              <option value="fast">Fast</option>
              <option value="hq" disabled>
                HQ — coming soon
              </option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 120px" }}>
            <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Poll every (minutes)</span>
            <input
              type="number"
              min={1}
              max={MAX_POLL_MINUTES}
              value={pollMinutes}
              onChange={(e) =>
                setPollMinutes(Math.min(MAX_POLL_MINUTES, Math.max(1, Number(e.target.value) || 1)))
              }
              disabled={destinations.length === 0 || driveNotReady}
              style={inputStyle(destinations.length === 0 || driveNotReady)}
            />
          </label>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--color-text)" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={destinations.length === 0 || driveNotReady}
            style={{ accentColor: "#0caab8" }}
          />
          Watch folder (auto-poll)
        </label>

        {formError && <div style={{ fontSize: 12, color: "var(--color-red)" }}>{formError}</div>}

        <button
          type="submit"
          disabled={submitting || destinations.length < 2 || driveNotReady}
          style={{
            alignSelf: "flex-start",
            fontSize: 12.5,
            fontWeight: 700,
            color: "#fff",
            background: "var(--ink)",
            border: "none",
            padding: "9px 16px",
            borderRadius: 9,
            cursor: submitting || destinations.length < 2 || driveNotReady ? "not-allowed" : "pointer",
            opacity: submitting || destinations.length < 2 || driveNotReady ? 0.7 : 1,
          }}
        >
          {submitting ? "Creating…" : "Create workflow"}
        </button>
      </form>

      {loading && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-muted)", fontSize: 13 }}>
          Loading workflows…
        </div>
      )}

      {!loading && workflows.length === 0 && destinations.length > 0 && (
        <div
          style={{
            padding: "14px 16px",
            border: "1px dashed var(--color-line2)",
            borderRadius: 12,
            color: "var(--color-muted)",
            fontSize: 12.5,
            background: "#0d0d13",
          }}
        >
          No workflows yet — connect an inbox folder above.
        </div>
      )}

      {workflows.map((wf) => {
        const busy = actionId === wf.id;
        return (
          <div
            key={wf.id}
            style={{
              background: "var(--color-panel)",
              border: "1px solid var(--color-line)",
              borderRadius: 14,
              padding: "14px 16px",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)" }}>{wf.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 4 }}>
                  {destName(destinations, wf.inbox_destination_id)} →{" "}
                  {destName(destinations, wf.output_destination_id)}
                  {" · "}one subfolder per source clip
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 4 }}>
                  {wf.count} variants · {wf.quality_mode} · poll every {Math.round(wf.poll_seconds / 60)} min
                  {wf.caption_from_filename ? " · filenames as captions" : ""}
                  {wf.auto_caption && !wf.caption_from_filename ? " · auto-caption on" : ""}
                  {wf.auto_caption && !wf.caption_from_filename ? ` · ${bankLabel(banks, wf.caption_bank_id)}` : ""}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-muted2)", marginTop: 6 }}>
                  Last sweep: {formatSummary(wf.last_summary)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--color-text)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={wf.enabled}
                    disabled={busy}
                    onChange={() => handleToggleEnabled(wf)}
                    style={{ accentColor: "#0caab8" }}
                  />
                  Watch
                </label>
                <button
                  type="button"
                  onClick={() => handleRun(wf)}
                  disabled={busy}
                  style={secondaryBtn(busy)}
                >
                  {busy ? "…" : "Run now"}
                </button>
                {workflowCanCancel(wf.last_summary) && (
                  <button
                    type="button"
                    onClick={() => handleCancel(wf)}
                    disabled={busy}
                    style={{ ...secondaryBtn(busy), color: "var(--color-red)" }}
                  >
                    {busy ? "Stopping…" : "Cancel"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(wf)}
                  disabled={busy}
                  style={{ ...secondaryBtn(busy), color: "var(--color-red)" }}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="workflow-card-captions">
              <label>
                <input
                  type="checkbox"
                  checked={!!wf.caption_from_filename}
                  disabled={busy}
                  onChange={() => handleToggleFilenameCaption(wf)}
                  style={{ accentColor: "#0caab8" }}
                />
                <span>
                  {workflowFilenameCaptionCardLabel()}
                  <span className="workflow-card-captions__hint">{workflowFilenameCaptionHint()}</span>
                </span>
              </label>
              {!wf.caption_from_filename && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!wf.auto_caption}
                    disabled={busy}
                    onChange={() => handleToggleAutoCaption(wf)}
                    style={{ accentColor: "#0caab8" }}
                  />
                  Auto-caption from bank
                </label>
              )}
              {banks.length > 0 && !wf.caption_from_filename && (
                <select
                  value={wf.caption_bank_id || banks.find((b) => b.is_default)?.id || ""}
                  disabled={busy}
                  onChange={(e) => handleCaptionBank(wf, e.target.value)}
                  style={{ ...inputStyle(busy), minWidth: 140 }}
                  aria-label="Caption folder"
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {captionFolderSelectLabel(b.name, b.count, b.remaining)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--color-panel2)",
    border: "1px solid var(--color-line)",
    borderRadius: 9,
    padding: "8px 12px",
    fontSize: 12.5,
    color: "var(--color-text)",
    outline: "none",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : undefined,
  };
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
    background: "var(--color-panel2)",
    border: "1px solid var(--color-line)",
    padding: "7px 12px",
    borderRadius: 9,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  };
}
