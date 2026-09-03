"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getGallery,
  getInstagramAnalytics,
  getInstagramStatus,
  linkInstagramMedia,
  regenerate,
  syncInstagram,
  unlinkInstagramMedia,
} from "@/lib/api";
import { InstagramPanel } from "@/components/InstagramPanel";
import {
  AMPLIFY_MORE_N,
  copiesForPack,
  galleryViewsCopy,
  handleLabel,
  packConversionCopy,
  packPickerOptions,
  parseCopyPick,
  rankedOriginalPrefix,
  suggestionButtonLabel,
  syncInsightsCopy,
  trackedCopyLabel,
  trackedCopyMeta,
  unmatchedCaptionPreview,
  unmatchedTabCopy,
  unlinkCopyLabel,
  moveCopyLabel,
} from "@/lib/instagram";
import type {
  InstagramAnalytics,
  InstagramStatus,
  InstagramSuggestion,
  InstagramTrackedCopy,
  InstagramUnmatched,
  SourceOut,
} from "@/lib/types";

function suggestionFor(
  sourceId: string,
  suggestions: InstagramSuggestion[],
): InstagramSuggestion | undefined {
  return suggestions.find((row) => row.source_id === sourceId);
}

function firstUnlinkedCopy(
  sources: SourceOut[],
  sourceId: string,
): string {
  const copies = copiesForPack(sources, sourceId);
  const open = copies.find((row) => !row.label.includes("(linked)"));
  return (open ?? copies[0])?.value ?? "";
}

export function AnalyticsBoard() {
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [analytics, setAnalytics] = useState<InstagramAnalytics | null>(null);
  const [unmatched, setUnmatched] = useState<InstagramUnmatched[]>([]);
  const [gallery, setGallery] = useState<SourceOut[]>([]);
  const [tab, setTab] = useState<"ranked" | "unmatched">("ranked");
  const [packId, setPackId] = useState("");
  const [copyPick, setCopyPick] = useState("");
  const [reelId, setReelId] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [amplifying, setAmplifying] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveFrom, setMoveFrom] = useState<{
    source_id: string;
    item: InstagramTrackedCopy;
  } | null>(null);
  const [movePackId, setMovePackId] = useState("");
  const [moveCopyPick, setMoveCopyPick] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function applyAnalytics(next: InstagramAnalytics, leftover?: InstagramUnmatched[]) {
    setAnalytics(next);
    const rows = leftover ?? next.unmatched ?? [];
    setUnmatched(rows);
    if (rows.length > 0 && gallery.length === 0) {
      setGallery(await getGallery());
    }
  }

  async function load() {
    try {
      const [nextStatus, nextAnalytics, nextGallery] = await Promise.all([
        getInstagramStatus(),
        getInstagramAnalytics(),
        getGallery(),
      ]);
      setStatus(nextStatus);
      setGallery(nextGallery);
      await applyAnalytics(nextAnalytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Analytics");
    }
  }

  useEffect(() => {
    void load();
    // First paint only — later Sync / Link refresh through those handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setNote(null);
    try {
      const out = await syncInstagram();
      const leftover = out.unmatched ?? out.analytics.unmatched ?? [];
      if (leftover.length > 0) {
        setGallery(await getGallery());
      }
      await applyAnalytics(out.analytics, leftover);
      setPackId("");
      setCopyPick("");
      setReelId("");
      setMoveFrom(null);
      setTab("ranked");
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

  async function handleUnlink(sourceId: string, index: number) {
    const key = `${sourceId}:${index}`;
    setUnlinking(key);
    setError(null);
    try {
      const next = await unlinkInstagramMedia({ source_id: sourceId, index });
      await applyAnalytics(next, next.unmatched ?? unmatched);
      setNote("Removed from tracking. Ranked totals no longer include that Reel.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setUnlinking(null);
    }
  }

  async function handleStartMove(sourceId: string, item: InstagramTrackedCopy) {
    setError(null);
    const rows = gallery.length ? gallery : await getGallery();
    if (!gallery.length) setGallery(rows);
    setMoveFrom({ source_id: sourceId, item });
    const dest = rows.find((row) => row.source_id !== sourceId) ?? rows[0];
    setMovePackId(dest?.source_id ?? "");
    setMoveCopyPick(dest ? firstUnlinkedCopy(rows, dest.source_id) : "");
  }

  function handleMovePickPack(sourceId: string) {
    setMovePackId(sourceId);
    setMoveCopyPick(sourceId ? firstUnlinkedCopy(gallery, sourceId) : "");
  }

  async function handleMoveReel() {
    const dest = parseCopyPick(moveCopyPick);
    if (!moveFrom || !dest) return;
    if (dest.source_id === moveFrom.source_id && dest.index === moveFrom.item.index) return;
    setMoving(true);
    setError(null);
    try {
      const next = await linkInstagramMedia({
        source_id: dest.source_id,
        index: dest.index,
        media_id: moveFrom.item.ig_media_id,
        ig_user_id: moveFrom.item.ig_user_id,
        permalink: moveFrom.item.post_url ?? null,
        username: moveFrom.item.username ?? null,
      });
      await applyAnalytics(next, next.unmatched ?? unmatched);
      setGallery(await getGallery());
      setMoveFrom(null);
      setNote("Moved that Reel onto the other original. Ranked totals follow the new pack.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setMoving(false);
    }
  }

  function handlePickPack(sourceId: string) {
    setPackId(sourceId);
    setCopyPick(sourceId ? firstUnlinkedCopy(gallery, sourceId) : "");
    setReelId("");
  }

  async function handleLink() {
    const item = unmatched.find((row) => row.media_id === reelId);
    const pick = parseCopyPick(copyPick);
    if (!item || !pick) return;
    setLinking(true);
    setError(null);
    try {
      const next = await linkInstagramMedia({
        source_id: pick.source_id,
        index: pick.index,
        media_id: item.media_id,
        ig_user_id: item.ig_user_id,
        permalink: item.permalink,
        username: item.username,
      });
      await applyAnalytics(next, next.unmatched ?? unmatched.filter((row) => row.media_id !== item.media_id));
      setGallery(await getGallery());
      setReelId("");
      setCopyPick(firstUnlinkedCopy(gallery, packId));
      setNote("Linked. Captions can change; tracking holds on this Reel id.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setLinking(false);
    }
  }

  const accounts = analytics?.accounts ?? status?.accounts ?? [];
  const ranked = analytics?.ranked ?? [];
  const suggestions = analytics?.suggestions ?? [];
  const lanes = analytics?.lanes ?? [];
  const headline = galleryViewsCopy(
    analytics?.insights_views,
    analytics?.insights_linked ?? 0,
    accounts.length,
  );
  const packOptions = useMemo(() => packPickerOptions(gallery), [gallery]);
  const copyOptions = useMemo(() => copiesForPack(gallery, packId), [gallery, packId]);
  const moveCopyOptions = useMemo(
    () => copiesForPack(gallery, movePackId),
    [gallery, movePackId],
  );
  const selectedReel = unmatched.find((row) => row.media_id === reelId);
  const canLink = Boolean(packId && copyPick && selectedReel) && !linking;
  const moveDest = parseCopyPick(moveCopyPick);
  const canMove = Boolean(
    moveFrom
    && moveDest
    && !moving
    && (moveDest.source_id !== moveFrom.source_id || moveDest.index !== moveFrom.item.index),
  );

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

      <div className="gallery-segments analytics-tabs" role="tablist" aria-label="Analytics views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ranked"}
          data-active={tab === "ranked"}
          onClick={() => setTab("ranked")}
        >
          Ranked originals
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "unmatched"}
          data-active={tab === "unmatched"}
          onClick={() => setTab("unmatched")}
        >
          Unmatched Reels ({unmatched.length})
        </button>
      </div>

      {tab === "ranked" && (
        <section className="drive-card" aria-label="Ranked originals">
          <div className="drive-card__title">Ranked originals</div>
          <p className="drive-card__copy">
            Unit of winning is the source — mint more unique files of the original that is working.
            Tracked copies are the Reels actually linked. Move a Reel if it landed on the wrong
            original. Remove it if the match is wrong, including posts from an account that is
            no longer connected. Unlinked copies are unknown, not zero views.
          </p>
          {ranked.length === 0 ? (
            <div className="drive-table__empty">No linked Reels yet. Connect testers, then Sync insights.</div>
          ) : (
            <div className="analytics-ranked">
              {ranked.map((row) => {
                const copies = (row.insights_linked || 0) + (row.insights_unknown || 0);
                const copy = packConversionCopy(
                  row.insights_views,
                  row.insights_shares,
                  row.insights_follows,
                  row.insights_linked,
                  copies || row.insights_linked,
                );
                const suggestion = suggestionFor(row.source_id, suggestions);
                const amplify = suggestion ? suggestionButtonLabel(suggestion.kind) : null;
                const tracked = row.tracked ?? [];
                return (
                  <div key={row.source_id} className="analytics-ranked__row">
                    <div className="analytics-ranked__main">
                      <div className="analytics-ranked__name" title={row.filename}>
                        {rankedOriginalPrefix(suggestion?.kind)}
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
                      {tracked.length > 0 && (
                        <ul className="analytics-ranked__tracked">
                          {tracked.map((item) => {
                            const unlinkKey = `${row.source_id}:${item.index}`;
                            const movingThis = Boolean(
                              moveFrom
                              && moveFrom.source_id === row.source_id
                              && moveFrom.item.index === item.index,
                            );
                            const meta = trackedCopyMeta(item);
                            return (
                              <li
                                key={item.ig_media_id || unlinkKey}
                                className="analytics-ranked__copy"
                                data-connected={item.account_connected === false ? "false" : "true"}
                              >
                                <div className="analytics-ranked__copy-main">
                                  <span className="analytics-ranked__copy-name">
                                    {trackedCopyLabel(item.index)}
                                  </span>
                                  {meta ? (
                                    <span className="analytics-ranked__copy-meta">{meta}</span>
                                  ) : null}
                                  {item.post_url ? (
                                    <a href={item.post_url} target="_blank" rel="noreferrer">
                                      Open Reel
                                    </a>
                                  ) : null}
                                </div>
                                <div className="analytics-ranked__copy-actions">
                                  <button
                                    type="button"
                                    className="gallery-quiet-link"
                                    aria-label={moveCopyLabel(item.index)}
                                    onClick={() => void handleStartMove(row.source_id, item)}
                                    disabled={moving}
                                  >
                                    Move
                                  </button>
                                  <button
                                    type="button"
                                    className="gallery-quiet-link"
                                    aria-label={unlinkCopyLabel(item.index)}
                                    onClick={() => void handleUnlink(row.source_id, item.index)}
                                    disabled={unlinking === unlinkKey}
                                  >
                                    {unlinking === unlinkKey ? "Removing…" : "Remove"}
                                  </button>
                                </div>
                                {movingThis && (
                                  <div className="analytics-match analytics-ranked__move">
                                    <label className="analytics-match__field">
                                      <span>Move to Gallery pack</span>
                                      <select
                                        aria-label="Move to Gallery pack"
                                        value={movePackId}
                                        onChange={(e) => handleMovePickPack(e.target.value)}
                                      >
                                        <option value="">Pick a Gallery pack…</option>
                                        {packOptions.map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    {movePackId ? (
                                      <label className="analytics-match__field">
                                        <span>Copy it belongs on</span>
                                        <select
                                          aria-label="Move to copy"
                                          value={moveCopyPick}
                                          onChange={(e) => setMoveCopyPick(e.target.value)}
                                        >
                                          <option value="">Pick a copy…</option>
                                          {moveCopyOptions.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                              {opt.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    ) : null}
                                    <div className="analytics-ranked__move-submit">
                                      <button
                                        type="button"
                                        className="drive-btn drive-btn--aqua drive-btn--sm"
                                        onClick={() => void handleMoveReel()}
                                        disabled={!canMove}
                                      >
                                        {moving ? "Moving…" : "Move Reel"}
                                      </button>
                                      <button
                                        type="button"
                                        className="gallery-quiet-link"
                                        onClick={() => setMoveFrom(null)}
                                        disabled={moving}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
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
      )}

      {tab === "ranked" && lanes.length > 0 && (
        <section className="drive-card" aria-label="Accounts">
          <div className="drive-card__title">Accounts</div>
          <p className="drive-card__copy">
            Main, trial, and growth stay separate. Each connected @handle is its own lane.
          </p>
          <div className="analytics-ranked">
            {lanes.map((lane) => {
              const copy = packConversionCopy(
                lane.insights_views,
                lane.insights_shares,
                lane.insights_follows,
                lane.insights_linked,
              );
              const label = handleLabel(lane.username || "") || lane.ig_user_id;
              const disconnected = lane.account_connected === false;
              return (
                <div key={lane.ig_user_id} className="analytics-ranked__row">
                  <div className="analytics-ranked__main">
                    <div className="analytics-ranked__name">{label}</div>
                    <div className="analytics-ranked__meta">
                      {disconnected ? "Account not connected · " : ""}
                      {copy}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "unmatched" && (
        <section className="drive-card" aria-label="Unmatched Reels">
          <div className="drive-card__title">Unmatched Reels</div>
          <p className="drive-card__copy">{unmatchedTabCopy(unmatched.length)}</p>
          {unmatched.length > 0 && (
            <div className="analytics-match">
              <label className="analytics-match__field">
                <span>Gallery pack</span>
                <select
                  aria-label="Pick a Gallery pack"
                  value={packId}
                  onChange={(e) => handlePickPack(e.target.value)}
                >
                  <option value="">Pick a Gallery pack…</option>
                  {packOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {packId ? (
                <label className="analytics-match__field">
                  <span>Copy you posted</span>
                  <select
                    aria-label="Pick the copy you posted"
                    value={copyPick}
                    onChange={(e) => setCopyPick(e.target.value)}
                  >
                    <option value="">Pick a copy…</option>
                    {copyOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          )}
          {packId && unmatched.length > 0 ? (
            <>
              <div className="analytics-picker">
                {unmatched.map((item) => {
                  const preview = unmatchedCaptionPreview(item.caption || "");
                  return (
                    <label key={item.media_id} className="analytics-picker__row analytics-picker__row--choice">
                      <input
                        type="radio"
                        name="unmatched-reel"
                        value={item.media_id}
                        checked={reelId === item.media_id}
                        onChange={() => setReelId(item.media_id)}
                        aria-label={preview}
                      />
                      <div className="analytics-picker__main">
                        <div className="analytics-picker__caption">{preview}</div>
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
                    </label>
                  );
                })}
              </div>
              <div className="analytics-match__submit">
                <button
                  type="button"
                  className="drive-btn drive-btn--aqua drive-btn--sm"
                  onClick={() => void handleLink()}
                  disabled={!canLink}
                >
                  {linking ? "Linking…" : "Link Reel"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}

      <InstagramPanel />
    </div>
  );
}
