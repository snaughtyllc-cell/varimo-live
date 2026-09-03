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
import { InsightsPackSheet } from "@/components/analytics/InsightsPackSheet";
import { PackThumb } from "@/components/analytics/PackThumb";
import {
  AMPLIFY_MORE_N,
  copiesForPack,
  formatDelta,
  formatViews,
  galleryViewsCopy,
  handleLabel,
  packPickerOptions,
  parseCopyPick,
  rankedOriginalPrefix,
  shouldRefreshInsights,
  syncInsightsCopy,
  unmatchedCaptionPreview,
  unmatchedTabCopy,
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

function packIndexMetrics(row: {
  insights_views: number | null;
  insights_views_delta?: number | null;
  insights_shares?: number | null;
  insights_likes?: number | null;
  insights_reach?: number | null;
}) {
  const metrics: { label: string; value: string; delta?: string | null; deltaDir?: "up" | "down" }[] = [];
  if (typeof row.insights_views === "number") {
    const delta = formatDelta(row.insights_views_delta);
    metrics.push({
      label: "views",
      value: formatViews(row.insights_views),
      delta,
      deltaDir: typeof row.insights_views_delta === "number" && row.insights_views_delta < 0 ? "down" : "up",
    });
  }
  if (typeof row.insights_shares === "number") metrics.push({ label: "shares", value: formatViews(row.insights_shares) });
  if (typeof row.insights_likes === "number") metrics.push({ label: "likes", value: formatViews(row.insights_likes) });
  if (typeof row.insights_reach === "number") metrics.push({ label: "reach", value: formatViews(row.insights_reach) });
  return metrics;
}

export function AnalyticsBoard() {
  const [status, setStatus] = useState<InstagramStatus | null>(null);
  const [analytics, setAnalytics] = useState<InstagramAnalytics | null>(null);
  const [unmatched, setUnmatched] = useState<InstagramUnmatched[]>([]);
  const [gallery, setGallery] = useState<SourceOut[]>([]);
  const [tab, setTab] = useState<"ranked" | "unmatched">("ranked");
  const [selectedSourceId, setSelectedSourceId] = useState("");
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

  async function pullInsights() {
    const out = await syncInstagram();
    const leftover = out.unmatched ?? out.analytics.unmatched ?? [];
    if (leftover.length > 0) {
      setGallery(await getGallery());
    }
    await applyAnalytics(out.analytics, leftover);
    setNote(syncInsightsCopy(out));
    return out;
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
      if (shouldRefreshInsights({
        connected: nextStatus.connected,
        fetchedAt: nextAnalytics.insights_fetched_at,
      })) {
        setSyncing(true);
        setError(null);
        try {
          await pullInsights();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sync failed");
        } finally {
          setSyncing(false);
        }
      }
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
      await pullInsights();
      setPackId("");
      setCopyPick("");
      setReelId("");
      setMoveFrom(null);
      setSelectedSourceId("");
      setTab("ranked");
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
  const headline = galleryViewsCopy(
    analytics?.insights_views,
    analytics?.insights_linked ?? 0,
    accounts.length,
    analytics?.insights_views_delta,
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
  const sourceById = useMemo(
    () => new Map(gallery.map((source) => [source.source_id, source])),
    [gallery],
  );
  const accountNames = useMemo(() => {
    const names = Object.fromEntries(accounts.map((account) => [account.user_id, account.username]));
    for (const lane of analytics?.lanes ?? []) {
      if (lane.username) names[lane.ig_user_id] = lane.username;
    }
    return names;
  }, [accounts, analytics?.lanes]);
  const selectedPack = ranked.find((row) => row.source_id === selectedSourceId);
  const canMove = Boolean(
    moveFrom
    && moveDest
    && !moving
    && (moveDest.source_id !== moveFrom.source_id || moveDest.index !== moveFrom.item.index),
  );

  useEffect(() => {
    if (selectedSourceId && !selectedPack) setSelectedSourceId("");
  }, [selectedPack, selectedSourceId]);

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
        <section className="analytics-pack-list" aria-label="Ranked originals">
          <h2>Ranked originals</h2>
          <p className="drive-card__copy">
            One row is one original. Open a pack to compare its accounts and tracked Reels.
          </p>
          {ranked.length === 0 ? (
            <div className="drive-table__empty">No linked Reels yet. Connect testers, then Sync insights.</div>
          ) : (
            <div className="analytics-pack-list__rows">
              {ranked.map((row) => {
                const suggestion = suggestionFor(row.source_id, suggestions);
                const source = sourceById.get(row.source_id);
                const metrics = packIndexMetrics(row);
                const unknown = row.insights_unknown ?? 0;
                return (
                  <button
                    key={row.source_id}
                    type="button"
                    className="analytics-pack-row"
                    data-kind={suggestion?.kind}
                    onClick={() => setSelectedSourceId(row.source_id)}
                  >
                    <span className="analytics-pack-row__thumb" aria-hidden="true">
                      <PackThumb source={source} />
                    </span>
                    <span className="analytics-pack-row__body">
                      <span className="analytics-pack-row__name" title={row.filename}>
                        {rankedOriginalPrefix(suggestion?.kind)}{row.filename}
                      </span>
                      <span className="analytics-pack-row__metrics">
                        {metrics.map((metric) => (
                          <span key={metric.label}>
                            <b>{metric.value}</b> {metric.label}
                            {metric.delta ? (
                              <span className="analytics-pack-row__delta" data-dir={metric.deltaDir}>
                                {metric.delta}
                              </span>
                            ) : null}
                          </span>
                        ))}
                        {metrics.length === 0 ? <span>views unknown</span> : null}
                        <span>{row.insights_linked} linked</span>
                        {unknown > 0 ? <span>{unknown} unknown</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
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

      {selectedPack ? (
        <InsightsPackSheet
          pack={selectedPack}
          source={sourceById.get(selectedPack.source_id)}
          suggestion={suggestionFor(selectedPack.source_id, suggestions)}
          accountNames={accountNames}
          onClose={() => {
            setSelectedSourceId("");
            setMoveFrom(null);
          }}
          onAmplify={handleAmplify}
          amplifying={amplifying === selectedPack.source_id}
          onStartMove={(sourceId, item) => void handleStartMove(sourceId, item)}
          onUnlink={(sourceId, index) => void handleUnlink(sourceId, index)}
          unlinking={unlinking}
          moveFrom={moveFrom}
          movePackId={movePackId}
          moveCopyPick={moveCopyPick}
          packOptions={packOptions}
          moveCopyOptions={moveCopyOptions}
          moving={moving}
          canMove={canMove}
          onMovePack={handleMovePickPack}
          onMoveCopy={setMoveCopyPick}
          onMoveReel={() => void handleMoveReel()}
          onCancelMove={() => setMoveFrom(null)}
        />
      ) : null}

      <InstagramPanel />
    </div>
  );
}
