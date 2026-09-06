"use client";
import { useEffect, useState } from "react";
import { ensureDropLedger, getDropLedgerStatus, syncDropLedger } from "@/lib/api";
import type { DropLedgerStatus, DropLedgerSync } from "@/lib/types";

function needsGoogleConnect(status: DropLedgerStatus | null): boolean {
  return Boolean(status && /connect google/i.test(status.message));
}

export function DropLedgerPanel() {
  const [status, setStatus] = useState<DropLedgerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ensuring, setEnsuring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<DropLedgerSync | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await getDropLedgerStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Drop Ledger status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const googleMissing = needsGoogleConnect(status);
  const busy = ensuring || syncing;
  const actionsDisabled = loading || busy || googleMissing;
  const sheetUrl = status?.spreadsheet_url;
  const badgeLabel = loading ? null : status?.configured ? "READY" : "NO SHEET";

  async function handleEnsure() {
    if (actionsDisabled) return;
    setEnsuring(true);
    setError(null);
    try {
      const out = await ensureDropLedger();
      setStatus({
        configured: true,
        spreadsheet_id: out.spreadsheet_id,
        spreadsheet_url: out.spreadsheet_url,
        message: out.created
          ? "Created VaryForge Drop Ledger"
          : "Drop Ledger is ready",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the Drop Ledger sheet");
    } finally {
      setEnsuring(false);
    }
  }

  async function handleSync() {
    if (actionsDisabled) return;
    setSyncing(true);
    setError(null);
    try {
      const out = await syncDropLedger({ ensure: true });
      setSyncResult(out);
      setStatus({
        configured: true,
        spreadsheet_id: out.spreadsheet_id,
        spreadsheet_url: out.spreadsheet_url,
        message: "Drop Ledger is ready",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync from Studio");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="drive-ledger-card drive-card">
      <div className="drive-card__title-row">
        <div className="drive-card__title">Drop Ledger</div>
        {badgeLabel && (
          <div className={`drive-badge${badgeLabel === "READY" ? " drive-badge--ok" : ""}`}>{badgeLabel}</div>
        )}
      </div>
      <div className="drive-card__copy">
        A Sheet of Passed / Duplicate / Flagged per clip so labels survive a wipe. Mark
        results in the Gallery — unlabeled clips count as pass. This does not change uniqueness.
      </div>

      <div className="drive-ledger-card__status">
        {loading ? "Loading…" : status?.message || "No status yet."}
      </div>

      {googleMissing && (
        <div role="status" className="drive-banner">
          Connect Google above first. Then tap Ensure sheet to create VaryForge Drop Ledger.
        </div>
      )}

      {error && (
        <div role="alert" className="drive-banner">
          {error}
        </div>
      )}

      {syncResult && (
        <div role="status" className="drive-ledger-card__sync">
          Synced {syncResult.rows} clips — {syncResult.inserted} new, {syncResult.updated}{" "}
          updated, {syncResult.unchanged} unchanged. Existing labels were kept.
        </div>
      )}

      <div className="drive-ledger-card__actions">
        <button
          type="button"
          onClick={() => void handleEnsure()}
          disabled={actionsDisabled}
          className="drive-btn drive-btn--dark drive-btn--sm"
        >
          {ensuring ? "Creating sheet…" : "Ensure sheet"}
        </button>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={actionsDisabled}
          className="drive-btn drive-btn--outline drive-btn--sm"
        >
          {syncing ? "Syncing…" : "Sync from Studio"}
        </button>
        {sheetUrl && (
          <a href={sheetUrl} target="_blank" rel="noreferrer" className="drive-ledger-card__open-link">
            Open sheet
          </a>
        )}
      </div>
    </div>
  );
}
