"use client";

import { useEffect, useState } from "react";
import {
  disconnectInstagram,
  getInstagramStatus,
  pasteInstagramToken,
} from "@/lib/api";
import {
  INSTAGRAM_OAUTH_START,
  INSTAGRAM_TESTER_HINT,
  handleLabel,
  igOauthErrorMessage,
} from "@/lib/instagram";
import { canManageInstagram } from "@/lib/navAccess";
import { useAuthMe } from "@/lib/useAuthMe";
import type { InstagramStatus } from "@/lib/types";

export function InstagramPanel() {
  const { data: me } = useAuthMe();
  const canManage = canManageInstagram(me);
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const next = await getInstagramStatus();
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Instagram status");
    }
  }

  useEffect(() => {
    if (!canManage) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("ig") === "error") {
      setBanner(igOauthErrorMessage(q.get("reason")));
    } else if (q.get("ig") === "connected") {
      setBanner("Instagram tester connected. Sync on Analytics to pull views onto packs.");
    }
    void refresh();
  }, [canManage]);

  async function handleDisconnect(userId: string, username: string) {
    if (!window.confirm(`Disconnect ${handleLabel(username)}? Other testers stay connected.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await disconnectInstagram(userId);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await pasteInstagramToken(token.trim());
      setStatus(next);
      setToken("");
      setPasteOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not store that token");
    } finally {
      setBusy(false);
    }
  }

  const accounts = status?.accounts ?? [];
  const connectLabel = accounts.length > 0 ? "Connect another account" : "Connect Instagram";

  if (!canManage) return null;

  return (
    <div className="drive-card ig-panel">
      <div className="drive-card__title-row">
        <div className="drive-card__title">Instagram testers</div>
        {accounts.length > 0 && (
          <span className="drive-badge drive-badge--ok">{accounts.length} connected</span>
        )}
      </div>
      <p className="drive-card__copy">{INSTAGRAM_TESTER_HINT}</p>
      {banner && (
        <div className="drive-banner" role="status">
          {banner}
        </div>
      )}
      {error && (
        <div className="drive-form-error" role="alert">
          {error}
        </div>
      )}
      {status?.message && accounts.length === 0 && (
        <p className="drive-card__copy">{status.message}</p>
      )}
      {accounts.map((account) => (
        <div key={account.user_id} className="drive-card__row">
          <div>
            <div className="drive-card__row-label">{handleLabel(account.username)}</div>
            {account.name ? <div className="drive-card__row-value">{account.name}</div> : null}
          </div>
          {canManage && (
            <button
              type="button"
              className="drive-btn drive-btn--outline drive-btn--sm drive-btn--danger"
              onClick={() => handleDisconnect(account.user_id, account.username)}
              disabled={busy}
              aria-label={`Disconnect ${handleLabel(account.username)}`}
            >
              Disconnect
            </button>
          )}
        </div>
      ))}
      {canManage && (
        <div className="ig-panel__actions">
          {status?.oauth_available !== false ? (
            <a href={INSTAGRAM_OAUTH_START} className="drive-btn drive-btn--dark drive-btn--sm">
              {connectLabel}
            </a>
          ) : (
            <p className="drive-card__copy">
              Instagram app not set on this Pod — ask an admin to set VARIANT_IG_APP_ID /
              VARIANT_IG_APP_SECRET.
            </p>
          )}
          <button
            type="button"
            className="gallery-quiet-link"
            onClick={() => setPasteOpen((open) => !open)}
          >
            Paste a token instead
          </button>
        </div>
      )}
      {pasteOpen && canManage && (
        <form className="ig-panel__paste" onSubmit={handlePaste}>
          <label htmlFor="ig-long-lived-token">Long-lived token</label>
          <input
            id="ig-long-lived-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="drive-input"
          />
          <button type="submit" className="drive-btn drive-btn--outline drive-btn--sm" disabled={busy}>
            Save token
          </button>
        </form>
      )}
    </div>
  );
}
