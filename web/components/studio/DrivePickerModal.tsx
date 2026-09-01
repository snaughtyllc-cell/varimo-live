"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { getDriveStatus, listDestinationVideos, listDestinations } from "@/lib/api";
import type { Destination, DriveStatus, DriveVideo } from "@/lib/types";

export interface DrivePick {
  destinationId: string;
  id: string;
  name: string;
  thumbUrl?: string;
}

interface DrivePickerModalProps {
  existingDestinationId: string | null;
  onConfirm: (picks: DrivePick[]) => void;
  onClose: () => void;
}

export function DrivePickerModal({ existingDestinationId, onConfirm, onClose }: DrivePickerModalProps) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [destinationId, setDestinationId] = useState("");
  const [videos, setVideos] = useState<DriveVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const driveNotReady = status != null && status.status !== "ready";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      try {
        const [s, d] = await Promise.all([getDriveStatus(), listDestinations()]);
        if (cancelled) return;
        setStatus(s);
        setDestinations(d);
        const initial =
          existingDestinationId && d.some((x) => x.id === existingDestinationId)
            ? existingDestinationId
            : d[0]?.id ?? "";
        setDestinationId(initial);
      } catch (e) {
        if (!cancelled) setVideoError(e instanceof Error ? e.message : "Failed to load Drive");
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existingDestinationId]);

  useEffect(() => {
    if (!destinationId || driveNotReady) {
      setVideos([]);
      setSelected(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingVideos(true);
      setVideoError(null);
      setVideos([]);
      setSelected(new Set());
      try {
        const res = await listDestinationVideos(destinationId);
        if (cancelled) return;
        setVideos(res.videos);
      } catch (e) {
        if (!cancelled) setVideoError(e instanceof Error ? e.message : "Failed to list videos");
      } finally {
        if (!cancelled) setLoadingVideos(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinationId, driveNotReady]);

  function toggleVideo(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    if (!destinationId || selected.size === 0) return;
    const picks: DrivePick[] = videos
      .filter((v) => selected.has(v.id))
      .map((v) => ({ destinationId, id: v.id, name: v.name }));
    onConfirm(picks);
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(23, 42, 46, 0.32)",
            backdropFilter: "blur(3px)",
            zIndex: 60,
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 460,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 48px)",
            overflow: "auto",
            background: "#fbfdfd",
            border: "1px solid #c7dde0",
            borderRadius: 16,
            boxShadow: "0 26px 60px rgba(22, 58, 65, 0.22)",
            zIndex: 61,
            outline: "none",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
            <Dialog.Title style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
              From Google Drive
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              style={{
                marginLeft: "auto",
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "transparent",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-muted)",
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              ✕
            </Dialog.Close>
          </div>

          {loadingMeta && (
            <div style={{ fontSize: 12.5, color: "var(--color-muted)", padding: "12px 0" }}>
              Loading Drive…
            </div>
          )}

          {!loadingMeta && driveNotReady && (
            <div style={{ fontSize: 12.5, color: "#8e6119", lineHeight: 1.5 }}>
              <div style={{ marginBottom: 10 }}>{status?.message ?? "Google Drive is not connected."}</div>
              <Link href="/settings/drive" style={{ color: "var(--color-text)", fontWeight: 600 }}>
                Go to Settings → Drive
              </Link>
            </div>
          )}

          {!loadingMeta && !driveNotReady && destinations.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
              <div style={{ marginBottom: 10 }}>No saved Drive folders yet.</div>
              <Link href="/settings/drive" style={{ color: "var(--color-text)", fontWeight: 600 }}>
                Add a destination in Settings → Drive
              </Link>
            </div>
          )}

          {!loadingMeta && !driveNotReady && destinations.length > 0 && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Folder</span>
                <select
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  style={{
                    background: "var(--color-panel2)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontSize: 13,
                    color: "var(--color-text)",
                    outline: "none",
                  }}
                >
                  {destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 8 }}>
                Videos in this folder (not subfolders)
              </div>

              {loadingVideos && (
                <div style={{ fontSize: 12.5, color: "var(--color-muted)", padding: "16px 0" }}>
                  Loading videos…
                </div>
              )}

              {!loadingVideos && videoError && (
                <div style={{ fontSize: 12, color: "var(--color-red)", padding: "8px 0" }}>{videoError}</div>
              )}

              {!loadingVideos && !videoError && videos.length === 0 && (
                <div
                  style={{
                    padding: "14px 12px",
                    border: "1px dashed var(--color-line2)",
                    borderRadius: 10,
                    color: "var(--color-muted)",
                    fontSize: 12.5,
                    background: "#f7fbfb",
                  }}
                >
                  No videos in this folder.
                </div>
              )}

              {!loadingVideos && videos.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    maxHeight: 280,
                    overflowY: "auto",
                    marginBottom: 4,
                  }}
                >
                  {videos.map((v) => {
                    const checked = selected.has(v.id);
                    return (
                      <label
                        key={v.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 10px",
                          background: checked ? "#e2f5f6" : "var(--color-panel2)",
                          border: `1px solid ${checked ? "var(--color-line2)" : "var(--color-line)"}`,
                          borderRadius: 9,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleVideo(v.id)}
                          style={{ accentColor: "#0caab8" }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--color-text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {v.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
                <button
                  onClick={onClose}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--color-text)",
                    background: "var(--color-panel2)",
                    border: "1px solid var(--color-line)",
                    padding: "8px 14px",
                    borderRadius: 9,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={selected.size === 0}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "#fff",
                    background: "#172124",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: 9,
                    cursor: selected.size === 0 ? "not-allowed" : "pointer",
                    opacity: selected.size === 0 ? 0.7 : 1,
                  }}
                >
                  Add {selected.size > 0 ? `${selected.size} clip${selected.size !== 1 ? "s" : ""}` : "clips"}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
