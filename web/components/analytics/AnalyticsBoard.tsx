"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getGallery,
  getInstagramAnalytics,
  getInstagramStatus,
  linkInstagramMedia,
  regenerate,
  syncInstagram,
} from "@/lib/api";
import { InstagramPanel } from "@/components/InstagramPanel";
import {
  AMPLIFY_MORE_N,
  copyPickerOptions,
  galleryViewsCopy,
  handleLabel,
  packViewsCopy,
  parseCopyPick,
  suggestionButtonLabel,
  syncInsightsCopy,
  unmatchedCaptionPreview,
} from "@/lib/instagram";
import type {
  InstagramAnalytics,
  InstagramStatus,
  InstagramSuggestion,
  InstagramUnmatched,
  SourceOut,
} from "@/lib/types";

function suggestionFor(
  sourceId: string,
  suggestions: InstagramSuggestion[],
): InstagramSuggestion | undefined {
  return suggestions.find((row) => row.source_id === sourceId);
}

export function AnalyticsBoard() {
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [analytics, setAnalytics] = useState<InstagramAnalytics | null>(null);
  const [unmatched, setUnmatched] = useState<InstagramUnmatched[]>([]);
  const [gallery, setGallery] = useState<SourceOut[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [amplifying, setAmplifying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      const [nextStatus, nextAnalytics] = await Promise.all([
        getInstagramStatus(),
        getInstagramAnalytics(),
      ]);
      setStatus(nextStatus);
      setAnalytics(nextAnalytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Analytics");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setNote(null);
    try {
      const out = await syncInstagram();
      const leftover = out.unmatched ?? [];
      setAnalytics(out.analytics);
      setUnmatched(leftover);
      setPicks({});
      if (leftover.length > 0) {
        setGallery(await getGallery());
      }
      setNote(syncInsightsCopy(out));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAmplify(sourceId: string) {
    setAmplifying(sourceId);
    setError(null);
    try {
      await regenerate(sourceId, AMPLIFY_MORE_N);
      setNote(`Generating ${AMPLIFY_MORE_N} more of this original.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate more failed");
    } finally {
      setAmplifying(null);
    }
  }

  async function handleLink(item: InstagramUnmatched) {
    const pick = parseCopyPick(picks[item.media_id] || "");
    if (!pick) return;
    setLinking(item.media_id);
    setError(null);
    try {
      const next = await linkInstagramMedia({
        source_id: pick.source_id,
        index: pick.index,
        media_id: item.media_id,
        ig_user_id: item.ig_user_id,
        permalink: item.permalink,
      });
      setAnalytics(next);
      setUnmatched((rows) => rows.filter((row) => row.media_id !== item.media_id));
      setPicks((current) => {
        const next = { ...current };
        delete next[item.media_id];
        return next;
      });
      setNote("Linked. Captions can change; tracking holds on this Reel id.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setLinking(null);
    }
  }

  const accounts = analytics?.accounts ?? status?.accounts ?? [];
  const ranked = analytics?.ranked ?? [];
  const suggestions = analytics?.suggestions ?? [];
  const headline = galleryViewsCopy(
    analytics?.insights_views,
    analytics?.insights_linked ?? 0,
    accounts.length,
  );
  const pickerOptions = useMemo(() => copyPickerOptions(gallery), [gallery]);

  return (
    <div className="analytics-board">
      <div className="analytics-hero">
        <div>
          <p className="drive-eyebrow">Pack performance</p>
          <h2 className="analytics-hero__title">{headline}</h2>
          {accounts.length > 0 && (
            <p className="analytics-hero__accounts">
              {accounts.map((a) => handleLabel(a.username)).join(" · ")}
            </p>
          )}
        </div>
        <button
          type="button"
          className="drive-btn drive-btn--dark"
          onClick={handleSync}
          disabled={syncing || accounts.length === 0}
        >
          {syncing ? "Syncing…" : "Sync insights"}
        </button>
      </div>
      {error && (
        <div className="drive-form-error" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="drive-banner" role="status">
          {note}
        </div>
      )}

      <InstagramPanel />

      {unmatched.length > 0 && (
        <section className="drive-card" aria-label="Unmatched Reels">
          <div className="drive-card__title">Unmatched Reels</div>
          <p className="drive-card__copy">
            Caption matching is a hint. Banks reuse lines, so these did not auto-link.
            Pick the Gallery copy — identity is the Reel id after that.
          </p>
          <div className="analytics-picker">
            {unmatched.map((item) => (
              <div key={item.media_id} className="analytics-picker__row">
                <div className="analytics-picker__main">
                  <div className="analytics-picker__caption">
                    {unmatchedCaptionPreview(item.caption || "")}
                  </div>
                  <div className="analytics-picker__meta">
                    {item.username ? `${handleLabel(item.username)} · ` : ""}
                    {item.permalink ? (
                      <a href={item.permalink} target="_blank" rel="noreferrer">
                        Open Reel
                      </a>
                    ) : (
                      "No permalink"
                    )}
                  </div>
                </div>
                <div className="analytics-picker__actions">
                  <select
                    aria-label={`Match ${unmatchedCaptionPreview(item.caption || "", 40)} to a Gallery copy`}
                    value={picks[item.media_id] || ""}
                    onChange={(e) =>
                      setPicks((current) => ({ ...current, [item.media_id]: e.target.value }))
                    }
                  >
                    <option value="">Pick a copy…</option>
                    {pickerOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="drive-btn drive-btn--aqua drive-btn--sm"
                    onClick={() => handleLink(item)}
                    disabled={!picks[item.media_id] || linking === item.media_id}
                  >
                    {linking === item.media_id ? "Linking…" : "Link"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="drive-card" aria-label="Ranked originals">
        <div className="drive-card__title">Ranked originals</div>
        <p className="drive-card__copy">
          Unit of winning is the source — mint more unique files of the original that is working.
          Unlinked copies are unknown, not zero views.
        </p>
        {ranked.length === 0 ? (
          <div className="drive-table__empty">No linked Reels yet. Connect testers, then Sync insights.</div>
        ) : (
          <div className="analytics-ranked">
            {ranked.map((row) => {
              const copies = (row.insights_linked || 0) + (row.insights_unknown || 0);
              const copy = packViewsCopy(row.insights_views, row.insights_linked, copies || row.insights_linked);
              const suggestion = suggestionFor(row.source_id, suggestions);
              const amplify = suggestion ? suggestionButtonLabel(suggestion.kind) : null;
              return (
                <div key={row.source_id} className="analytics-ranked__row">
                  <div className="analytics-ranked__main">
                    <div className="analytics-ranked__name" title={row.filename}>
                      {suggestion?.kind === "winner" ? "Winner · " : ""}
                      {row.filename}
                    </div>
                    <div className="analytics-ranked__meta">{copy}</div>
                    {suggestion && (
                      <div
                        className="analytics-ranked__hint"
                        data-kind={suggestion.kind}
                      >
                        {suggestion.copy}
                      </div>
                    )}
                  </div>
                  {amplify && (
                    <button
                      type="button"
                      className="drive-btn drive-btn--aqua drive-btn--sm"
                      onClick={() => handleAmplify(row.source_id)}
                      disabled={amplifying === row.source_id}
                    >
                      {amplifying === row.source_id ? "Starting…" : amplify}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
