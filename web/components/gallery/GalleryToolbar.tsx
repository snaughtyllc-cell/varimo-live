"use client";

import Link from "next/link";

type FilterMode = "all" | "shortfall";
type SortMode = "newest";

interface GalleryToolbarProps {
  /** Kept for the page's call signature (and the toolbar test); the count now
   *  lives in the grid header's "REVIEW LIBRARY" title, matching the mock. */
  count: number;
  variantCount: number;
  /** Breadcrumb tail — the active pack's source filename (mock: GALLERY / <file>). */
  crumb?: string;
  filterMode: FilterMode;
  onFilter: (mode: FilterMode) => void;
  sort: SortMode;
  onSort: (sort: SortMode) => void;
  selectedCount: number;
  sendDisabledReason: string | null;
  onSend: () => void;
  selectAllLabel: string;
  selectAllDisabled?: boolean;
  onSelectAll: () => void;
  saveLabel: string;
  saveBusy?: boolean;
  saveDisabledReason: string | null;
  saveHint?: string | null;
  onSave: () => void;
  saveMsg?: string | null;
  /** When set, the bar is the variant-review chrome (Back to grid + vNN). */
  review?: {
    variantLabel: string;
    onBack: () => void;
    onPrev: () => void;
    onNext: () => void;
    canPrev: boolean;
    canNext: boolean;
  } | null;
}

export function GalleryToolbar({
  crumb,
  filterMode,
  onFilter,
  sort,
  onSort,
  selectedCount,
  sendDisabledReason,
  onSend,
  selectAllLabel,
  selectAllDisabled,
  onSelectAll,
  saveLabel,
  saveBusy,
  saveDisabledReason,
  saveHint,
  onSave,
  saveMsg,
  review,
}: GalleryToolbarProps) {
  const sendDisabled = sendDisabledReason != null;
  const saveDisabled = saveDisabledReason != null || !!saveBusy;
  return (
    <section className="gallery-toolbar" aria-label="Gallery controls">
      {review && (
        <button type="button" className="gallery-toolbar__back" onClick={review.onBack}>
          <span className="material-symbols-rounded" aria-hidden="true">grid_view</span>
          Back to grid
        </button>
      )}
      <div className="gallery-toolbar__crumb">
        <span className="gallery-toolbar__crumb-section">GALLERY</span>
        {crumb && (
          <>
            <span className="gallery-toolbar__crumb-sep" aria-hidden="true">/</span>
            <span className="gallery-toolbar__crumb-name" title={crumb}>{crumb}</span>
          </>
        )}
        {review && (
          <>
            <span className="gallery-toolbar__crumb-sep" aria-hidden="true">/</span>
            <span className="gallery-toolbar__crumb-variant">{review.variantLabel}</span>
          </>
        )}
      </div>
      {review && (
        <div className="gallery-toolbar__nav">
          <button
            type="button"
            className="gallery-toolbar__nav-btn"
            onClick={review.onPrev}
            disabled={!review.canPrev}
            aria-label="Previous variant"
          >
            <span className="material-symbols-rounded" aria-hidden="true">chevron_left</span>
          </button>
          <button
            type="button"
            className="gallery-toolbar__nav-btn"
            onClick={review.onNext}
            disabled={!review.canNext}
            aria-label="Next variant"
          >
            <span className="material-symbols-rounded" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      )}
      {!review && (
      <div className="gallery-toolbar__actions">
        <div className="gallery-segments" aria-label="Pack filter">
          <button type="button" data-active={filterMode === "all"} onClick={() => onFilter("all")}>
            All
          </button>
          <button type="button" data-active={filterMode === "shortfall"} onClick={() => onFilter("shortfall")}>
            Needs attention
          </button>
        </div>
        <Link className="gallery-quiet-link" href="/drops" aria-label="Sent to Drive">
          Sent
        </Link>
        <Link className="gallery-quiet-link" href="/drops?filter=flagged_week" aria-label="Flagged this week">
          Flagged
        </Link>
        <button type="button" className="gallery-quiet-link" onClick={() => onSort("newest")}>
          <span className="material-symbols-rounded" aria-hidden="true">swap_vert</span>
          {sort === "newest" ? "Newest" : "Newest"}
        </button>
        <button type="button" className="gallery-select-all" onClick={onSelectAll} disabled={selectAllDisabled}>
          <span className="material-symbols-rounded" aria-hidden="true">check_box</span>
          {selectAllLabel}
        </button>
        <span className="gallery-send-wrap">
          <button
            type="button"
            className="gallery-save-photos"
            onClick={onSave}
            disabled={saveDisabled}
            title={saveHint ?? saveDisabledReason ?? undefined}
          >
            <span className="material-symbols-rounded" aria-hidden="true">download</span>
            {saveBusy ? "Saving…" : saveLabel}
          </button>
          {saveDisabledReason && !saveBusy && <small>{saveDisabledReason}</small>}
        </span>
        <span className="gallery-send-wrap">
          <button
            type="button"
            className="vf-primary-button gallery-send-btn"
            onClick={onSend}
            disabled={sendDisabled}
            title={sendDisabledReason ?? undefined}
          >
            <span className="material-symbols-rounded" aria-hidden="true">cloud_upload</span>
            Send to Drive{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
          {sendDisabled && <small>{sendDisabledReason}</small>}
        </span>
      </div>
      )}
      {saveMsg && <p className="gallery-toolbar__save-msg">{saveMsg}</p>}
    </section>
  );
}
