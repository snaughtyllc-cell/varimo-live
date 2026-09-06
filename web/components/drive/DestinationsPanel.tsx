"use client";
import { useEffect, useState } from "react";
import {
  createDestination,
  deleteDestination,
  disconnectDriveOAuth,
  getDriveStatus,
  listDestinations,
  testDestination,
  updateDestination,
} from "@/lib/api";
import { oauthErrorMessage, truncateFolderId } from "@/lib/drive";
import {
  DRIVE_OPERATOR_WAIT,
  DRIVE_SHARE_BODY,
  DRIVE_SHARE_HEADING,
  driveShareEmail,
} from "@/lib/driveShareCopy";
import { canManageDriveOAuth } from "@/lib/navAccess";
import { useAuthMe } from "@/lib/useAuthMe";
import type { Destination, DriveStatus } from "@/lib/types";

type TestResult = { ok: boolean; message: string };

const STATE_COLORS: Record<"ok" | "untested" | "failed", string> = {
  ok: "#12b76a",
  untested: "#e0a32e",
  failed: "#e5533d",
};

export function DestinationsPanel() {
  const { data: me } = useAuthMe();
  const manageOAuth = canManageDriveOAuth(me);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const [name, setName] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFolderUrl, setEditFolderUrl] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [oauthBanner, setOauthBanner] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  async function refresh() {
    setIsLoading(true);
    try {
      const [s, d] = await Promise.all([getDriveStatus(), listDestinations()]);
      setStatus(s);
      setDestinations(d);
    } catch (e) {
      console.error("Failed to load Drive status", e);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("oauth") === "error") {
      setOauthBanner(oauthErrorMessage(q.get("reason")));
    }
    refresh();
  }, []);

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Google Drive? Destinations stay saved but exports stop until you reconnect.")) {
      return;
    }
    setDisconnecting(true);
    try {
      await disconnectDriveOAuth();
      await refresh();
    } catch (err) {
      console.error("Failed to disconnect Drive", err);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (driveNotReady || submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createDestination(name.trim(), folderUrl.trim());
      setDestinations((prev) => [...prev, created]);
      setName("");
      setFolderUrl("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add destination");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(dest: Destination) {
    setEditingId(dest.id);
    setEditName(dest.name);
    setEditFolderUrl("");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    if (driveNotReady || savingEditId) return;
    setEditError(null);
    setSavingEditId(id);
    try {
      const patch: { name?: string; folder_url?: string } = { name: editName.trim() };
      if (editFolderUrl.trim()) patch.folder_url = editFolderUrl.trim();
      const updated = await updateDestination(id, patch);
      setDestinations((prev) => prev.map((d) => (d.id === id ? updated : d)));
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update destination");
    } finally {
      setSavingEditId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this destination?")) return;
    try {
      await deleteDestination(id);
      setDestinations((prev) => prev.filter((d) => d.id !== id));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error("Failed to delete destination", err);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await testDestination(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: res.ok ? { ok: true, message: "Access confirmed" } : { ok: false, message: "Access failed" },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : "Access failed" },
      }));
    } finally {
      setTestingId(null);
    }
  }

  const driveNotReady = status != null && status.status !== "ready";
  const addFormDisabled = driveNotReady || submitting;
  const connectedEmail = status?.connected_email || status?.sa_email || null;
  const oauthAvailable = Boolean(status?.oauth_available);
  const isOauth = status?.auth_mode === "oauth";
  const shareEmail = driveShareEmail(status?.share_email);
  const shareMismatch =
    connectedEmail != null &&
    connectedEmail.toLowerCase() !== shareEmail.toLowerCase();

  async function copyShareEmail() {
    try {
      await navigator.clipboard.writeText(shareEmail);
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 1600);
    } catch {
      setCopiedShare(false);
    }
  }

  return (
    <div className="drive-panel-root">
      {/* Left column, part 1: connect flow — Step 1 share card. */}
      <div className="drive-slot-a">
        {oauthBanner && (
          <div className="drive-banner" role="alert">
            {oauthBanner}
          </div>
        )}

        {/* Share-email is the operator path until Connect-your-own-Google is the default. */}
        <div className="drive-eyebrow">Step 1 · {DRIVE_SHARE_HEADING}</div>
        <div data-testid="drive-share-card" className="drive-step1-card">
          <div className="drive-step1-card__row">
            <code data-testid="drive-share-email" className="drive-step1-card__email">
              {shareEmail}
            </code>
            <button type="button" onClick={copyShareEmail} className="drive-btn drive-btn--aqua">
              <span className="material-symbols-rounded" aria-hidden="true">content_copy</span>
              {copiedShare ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="drive-step1-card__body">{DRIVE_SHARE_BODY}</div>
          {shareMismatch && manageOAuth && (
            <div className="drive-step1-card__mismatch">
              Studio is still signed in as {connectedEmail}. Reconnect Google as {shareEmail}{" "}
              so shared folders actually open — operators should not share with a personal inbox.
            </div>
          )}
        </div>
      </div>

      {/* Right column: Google account — site admin only. Operators share studio@. */}
      <div className="drive-slot-account">
        {manageOAuth ? (
          <div className="drive-card">
            <div className="drive-card__title">Google account</div>
            {status?.status === "ready" && connectedEmail ? (
              <>
                <div className="drive-card__row">
                  <div className="drive-card__row-label">Google account</div>
                  <div className="drive-card__row-value">
                    {connectedEmail}
                    {status.auth_mode ? ` · ${status.auth_mode}` : ""}
                  </div>
                </div>
                {isOauth && (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="drive-card__row drive-card__row--action"
                  >
                    <div className="drive-card__row-label">
                      {disconnecting ? "Disconnecting…" : "Disconnect Drive"}
                    </div>
                    <span className="material-symbols-rounded" style={{ color: "var(--color-red)", fontSize: 18 }} aria-hidden="true">
                      logout
                    </span>
                  </button>
                )}
              </>
            ) : (
              <div className="drive-card__row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10, borderTop: "none" }}>
                <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                  {status?.message ?? "Checking Drive configuration…"}
                </div>
                {oauthAvailable ? (
                  <a href="/api/drive/oauth/start" className="drive-btn drive-btn--dark drive-btn--sm">
                    Connect Google
                  </a>
                ) : (
                  <div style={{ fontSize: 12, color: "#8e6119" }}>
                    OAuth client not set on this Pod — ask an admin to set{" "}
                    <code>VARIANT_DRIVE_OAUTH_CLIENT_ID</code> /{" "}
                    <code>VARIANT_DRIVE_OAUTH_CLIENT_SECRET</code>.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="drive-card">
            <div className="drive-card__title">Account</div>
            <div className="drive-card__row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 10, borderTop: "none" }}>
              <div style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.45 }}>
                {DRIVE_OPERATOR_WAIT}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Left column, part 2: Step 2 add-destination form + the table. */}
      <div className="drive-slot-b">
        {driveNotReady && (
          <div className="drive-banner">
            <strong>{manageOAuth ? status!.message : DRIVE_OPERATOR_WAIT}</strong>
            <small>Share folders as Editor with {shareEmail}</small>
          </div>
        )}

        <div className="drive-eyebrow">Step 2 · Add a destination</div>
        <form onSubmit={handleCreate} className="drive-step2-form">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            required
            disabled={driveNotReady}
            className="drive-input drive-input--name"
          />
          <input
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            placeholder="Paste Drive folder link"
            required
            disabled={driveNotReady}
            className="drive-input drive-input--url"
          />
          <button type="submit" disabled={addFormDisabled} className="drive-btn drive-btn--dark">
            {submitting ? "Adding…" : "Add"}
          </button>
          {formError && <div className="drive-form-error">{formError}</div>}
        </form>

        <div className="drive-destinations">
          <div className="drive-destinations__head">
            <div className="drive-eyebrow">Destinations · {destinations.length}</div>
            <div className="drive-destinations__filter" aria-hidden="true">
              <span className="material-symbols-rounded">search</span>
              <span>Filter destinations</span>
            </div>
          </div>
          <div className="drive-table">
            {!isLoading && destinations.length > 0 && (
              <div className="drive-table__row drive-table__row--head" aria-hidden="true">
                <div>Name</div>
                <div>Folder</div>
                <div>Access</div>
                <div />
              </div>
            )}

            {isLoading && <div className="drive-table__empty">Loading destinations…</div>}

            {!isLoading && destinations.length === 0 && (
              <div className="drive-table__empty">No destinations yet — add a Drive folder above.</div>
            )}

            {destinations.map((dest) => {
              const isEditing = editingId === dest.id;
              const testResult = testResults[dest.id];
              const editSaveDisabled = driveNotReady || savingEditId === dest.id;
              const stateKind: "ok" | "untested" | "failed" = !testResult
                ? "untested"
                : testResult.ok
                  ? "ok"
                  : "failed";
              const stateLabel = testResult ? testResult.message : "Not tested";

              if (isEditing) {
                return (
                  <div key={dest.id} className="drive-table__edit">
                    {driveNotReady && status && <div className="drive-form-error">{status.message}</div>}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Name"
                        disabled={driveNotReady}
                        className="drive-input drive-input--name"
                      />
                      <input
                        value={editFolderUrl}
                        onChange={(e) => setEditFolderUrl(e.target.value)}
                        placeholder="New Drive folder link (optional)"
                        disabled={driveNotReady}
                        className="drive-input drive-input--url"
                      />
                    </div>
                    {editError && <div className="drive-form-error">{editError}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(dest.id)}
                        disabled={editSaveDisabled}
                        className="drive-btn drive-btn--dark drive-btn--sm"
                      >
                        {savingEditId === dest.id ? "Saving…" : "Save"}
                      </button>
                      <button type="button" onClick={cancelEdit} className="drive-btn drive-btn--outline drive-btn--sm">
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={dest.id} className="drive-table__row">
                  <div className="drive-table__name">{dest.name}</div>
                  <div className="drive-table__id">{truncateFolderId(dest.folder_id)}</div>
                  <div className="drive-table__state">
                    <div className="drive-table__dot" style={{ background: STATE_COLORS[stateKind] }} />
                    <div className="drive-table__state-label">{stateLabel}</div>
                  </div>
                  <div className="drive-table__actions">
                    <button
                      onClick={() => handleTest(dest.id)}
                      disabled={testingId === dest.id || driveNotReady}
                      className="drive-btn drive-btn--outline drive-btn--sm"
                      title="Test access"
                    >
                      {testingId === dest.id ? "Testing…" : "Test"}
                    </button>
                    <button onClick={() => startEdit(dest)} className="drive-btn drive-btn--outline drive-btn--sm" title="Edit">
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(dest.id)}
                      className="drive-btn drive-btn--outline drive-btn--sm drive-btn--danger"
                      title="Delete"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
