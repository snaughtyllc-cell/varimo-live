"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import {
  formatViews,
  handleLabel,
  moveCopyLabel,
  rankedOriginalPrefix,
  suggestionButtonLabel,
  trackedCopyLabel,
  trackedCopyMeta,
  unlinkCopyLabel,
} from "@/lib/instagram";
import type {
  InstagramPackRow,
  InstagramSuggestion,
  InstagramTrackedCopy,
  SourceOut,
} from "@/lib/types";

type MetricSource = {
  insights_views?: number | null;
  insights_reach?: number | null;
  insights_likes?: number | null;
  insights_comments?: number | null;
  insights_shares?: number | null;
  insights_saved?: number | null;
  insights_follows?: number | null;
};

type Lane = MetricSource & {
  id: string;
  label: string;
  handle: string;
  linked: number;
  accountConnected: boolean;
};

type MoveState = {
  source_id: string;
  item: InstagramTrackedCopy;
} | null;

interface InsightsPackSheetProps {
  pack: InstagramPackRow;
  source?: SourceOut;
  suggestion?: InstagramSuggestion;
  accountNames: Record<string, string>;
  onClose: () => void;
  onAmplify: (sourceId: string) => void;
  amplifying: boolean;
  onStartMove: (sourceId: string, item: InstagramTrackedCopy) => void;
  onUnlink: (sourceId: string, index: number) => void;
  unlinking: string | null;
  moveFrom: MoveState;
  movePackId: string;
  moveCopyPick: string;
  packOptions: { value: string; label: string }[];
  moveCopyOptions: { value: string; label: string }[];
  moving: boolean;
  canMove: boolean;
  onMovePack: (sourceId: string) => void;
  onMoveCopy: (value: string) => void;
  onMoveReel: () => void;
  onCancelMove: () => void;
}

function isMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function summaryMetrics(row: MetricSource, includeFollows = false) {
  const metrics: { label: string; value: string }[] = [];
  if (isMetric(row.insights_views)) metrics.push({ label: "views", value: formatViews(row.insights_views) });
  if (isMetric(row.insights_reach)) metrics.push({ label: "reach", value: formatViews(row.insights_reach) });
  if (isMetric(row.insights_likes)) metrics.push({ label: "likes", value: formatViews(row.insights_likes) });
  if (isMetric(row.insights_comments)) metrics.push({ label: "comments", value: formatViews(row.insights_comments) });
  if (isMetric(row.insights_shares)) metrics.push({ label: "shares", value: formatViews(row.insights_shares) });
  if (isMetric(row.insights_saved)) metrics.push({ label: "saved", value: formatViews(row.insights_saved) });
  if (includeFollows && isMetric(row.insights_follows)) {
    metrics.push({ label: "follows", value: formatViews(row.insights_follows) });
  }
  return metrics;
}

function laneLabel(handle: string): string {
  if (/\bmain\b/i.test(handle)) return "Main lane";
  if (/\btrial\b/i.test(handle)) return "Trial lane";
  if (/\bgrowth\b/i.test(handle)) return "Growth lane";
  return "Account lane";
}

function aggregate(copies: InstagramTrackedCopy[], key: keyof MetricSource): number | null {
  let total = 0;
  let seen = false;
  for (const copy of copies) {
    const value = copy[key];
    if (isMetric(value)) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

function packLanes(
  copies: InstagramTrackedCopy[],
  accountNames: Record<string, string>,
): Lane[] {
  const grouped = new Map<string, InstagramTrackedCopy[]>();
  for (const copy of copies) {
    const key = copy.ig_user_id || copy.username || `copy-${copy.index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), copy]);
  }

  const laneOrder = (label: string) => {
    if (label === "Main lane") return 0;
    if (label === "Trial lane") return 1;
    if (label === "Growth lane") return 2;
    return 3;
  };

  return [...grouped.entries()].map(([id, items]) => {
    const first = items[0];
    const username = first.username || accountNames[first.ig_user_id || ""] || id;
    const handle = handleLabel(username) || "Account not named";
    return {
      id,
      label: laneLabel(username),
      handle,
      linked: items.length,
      accountConnected: !items.every((item) => item.account_connected === false),
      insights_views: aggregate(items, "insights_views"),
      insights_reach: aggregate(items, "insights_reach"),
      insights_likes: aggregate(items, "insights_likes"),
      insights_comments: aggregate(items, "insights_comments"),
      insights_shares: aggregate(items, "insights_shares"),
      insights_saved: aggregate(items, "insights_saved"),
      insights_follows: aggregate(items, "insights_follows"),
    };
  }).sort((a, b) => laneOrder(a.label) - laneOrder(b.label) || a.handle.localeCompare(b.handle));
}

function MetricRail({ metrics }: { metrics: { label: string; value: string }[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="analytics-metric-rail" aria-label="Insights metrics">
      {metrics.map((metric) => (
        <span key={metric.label} className="analytics-metric-chip">
          <b>{metric.value}</b> {metric.label}
        </span>
      ))}
    </div>
  );
}

export function InsightsPackSheet({
  pack,
  source,
  suggestion,
  accountNames,
  onClose,
  onAmplify,
  amplifying,
  onStartMove,
  onUnlink,
  unlinking,
  moveFrom,
  movePackId,
  moveCopyPick,
  packOptions,
  moveCopyOptions,
  moving,
  canMove,
  onMovePack,
  onMoveCopy,
  onMoveReel,
  onCancelMove,
}: InsightsPackSheetProps) {
  const tracked = pack.tracked ?? [];
  const lanes = packLanes(tracked, accountNames);
  const amplifyLabel = suggestion ? suggestionButtonLabel(suggestion.kind) : null;
  const hasHoldMetrics = tracked.some(
    (copy) => isMetric(copy.insights_skip_rate) || isMetric(copy.insights_watch_time),
  );
  const thumb = source?.variants.find((variant) => Boolean(variant.file_url))?.file_url;
  const packMetrics = summaryMetrics(pack);
  const unknown = pack.insights_unknown ?? 0;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="analytics-sheet-overlay" />
        <Dialog.Content
          className="analytics-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <header className="analytics-sheet__header">
            <div className="analytics-sheet__title-wrap">
              <Dialog.Title>{pack.filename} Insights</Dialog.Title>
              <span>{pack.insights_linked} linked Reel{pack.insights_linked === 1 ? "" : "s"}</span>
            </div>
            <Dialog.Close type="button" className="analytics-sheet__close" aria-label="Close Insights sheet">
              <X size={19} strokeWidth={2.1} aria-hidden="true" />
            </Dialog.Close>
          </header>

          <div className="analytics-sheet__body">
            <section className="analytics-pack-hero" aria-label="Pack totals">
              {thumb ? (
                <video className="analytics-pack-hero__thumb" src={thumb} muted playsInline preload="metadata" />
              ) : null}
              <div className="analytics-pack-hero__content">
                <h3>{rankedOriginalPrefix(suggestion?.kind)}{pack.filename}</h3>
                <MetricRail metrics={packMetrics} />
                <p>
                  {pack.insights_linked} linked · {unknown > 0
                    ? unknown === 1
                      ? "1 unlinked copy is unknown"
                      : `${unknown} unlinked copies are unknown`
                    : "all copies are linked"}
                </p>
              </div>
              {suggestion ? (
                <div className="analytics-pack-hero__suggestion" data-kind={suggestion.kind}>
                  <p>{suggestion.copy}</p>
                  {amplifyLabel ? (
                    <button
                      type="button"
                      className="drive-btn drive-btn--aqua drive-btn--sm"
                      onClick={() => onAmplify(pack.source_id)}
                      disabled={amplifying}
                    >
                      {amplifying ? "Starting…" : amplifyLabel}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="analytics-sheet__section" aria-label="By account">
              <h3>By account</h3>
              <p>Compare this original across the accounts that posted it.</p>
              {lanes.length === 0 ? (
                <div className="analytics-sheet__empty">No linked Reels for this original yet.</div>
              ) : (
                <div className="analytics-lanes">
                  {lanes.map((lane) => (
                    <div className="analytics-lane" key={lane.id} data-connected={lane.accountConnected ? "true" : "false"}>
                      <div className="analytics-lane__identity">
                        <strong>{lane.label}</strong>
                        <span>{lane.handle}{lane.accountConnected ? "" : " · account not connected"}</span>
                      </div>
                      <MetricRail metrics={summaryMetrics(lane, true)} />
                      <span className="analytics-lane__linked">{lane.linked} linked</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="analytics-sheet__section" aria-label="Tracked copies">
              <h3>Tracked copies</h3>
              <p>Linked copies have Instagram’s latest snapshot. Unlinked copies are unknown, not zero.</p>
              {tracked.length === 0 ? (
                <div className="analytics-sheet__empty">No linked copies yet.</div>
              ) : (
                <div className="analytics-copy-list">
                  {tracked.map((item) => {
                    const unlinkKey = `${pack.source_id}:${item.index}`;
                    const movingThis = Boolean(
                      moveFrom
                      && moveFrom.source_id === pack.source_id
                      && moveFrom.item.index === item.index,
                    );
                    return (
                      <article
                        className="analytics-copy-row"
                        key={item.ig_media_id || unlinkKey}
                        data-connected={item.account_connected === false ? "false" : "true"}
                      >
                        <div className="analytics-copy-row__head">
                          <strong>{trackedCopyLabel(item.index)}</strong>
                          <span>{trackedCopyMeta(item)}</span>
                        </div>
                        <div className="analytics-copy-row__actions">
                          {item.post_url ? (
                            <a href={item.post_url} target="_blank" rel="noreferrer">
                              Open Reel <ExternalLink size={13} aria-hidden="true" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            className="gallery-quiet-link"
                            aria-label={moveCopyLabel(item.index)}
                            onClick={() => onStartMove(pack.source_id, item)}
                            disabled={moving}
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            className="gallery-quiet-link"
                            aria-label={unlinkCopyLabel(item.index)}
                            onClick={() => onUnlink(pack.source_id, item.index)}
                            disabled={unlinking === unlinkKey}
                          >
                            {unlinking === unlinkKey ? "Removing…" : "Remove"}
                          </button>
                        </div>
                        {movingThis ? (
                          <div className="analytics-match analytics-copy-row__move">
                            <label className="analytics-match__field">
                              <span>Move to Gallery pack</span>
                              <select
                                aria-label="Move to Gallery pack"
                                value={movePackId}
                                onChange={(event) => onMovePack(event.target.value)}
                              >
                                <option value="">Pick a Gallery pack…</option>
                                {packOptions.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </label>
                            {movePackId ? (
                              <label className="analytics-match__field">
                                <span>Copy it belongs on</span>
                                <select
                                  aria-label="Move to copy"
                                  value={moveCopyPick}
                                  onChange={(event) => onMoveCopy(event.target.value)}
                                >
                                  <option value="">Pick a copy…</option>
                                  {moveCopyOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            <div className="analytics-copy-row__move-submit">
                              <button
                                type="button"
                                className="drive-btn drive-btn--aqua drive-btn--sm"
                                onClick={onMoveReel}
                                disabled={!canMove}
                              >
                                {moving ? "Moving…" : "Move Reel"}
                              </button>
                              <button
                                type="button"
                                className="gallery-quiet-link"
                                onClick={onCancelMove}
                                disabled={moving}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
              {!hasHoldMetrics && tracked.length > 0 ? (
                <p className="analytics-sheet__lag">Instagram omitted hold metrics this pass; skip and watch can lag about 48 hours.</p>
              ) : null}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
