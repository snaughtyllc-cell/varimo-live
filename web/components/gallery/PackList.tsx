"use client";

import { PosterThumb } from "@/components/common/PosterThumb";
import { SourceOut } from "@/lib/types";
import { avgOriginalityPct, filesReadyCount, isFileReady, packMetaLabel, packOriginalityColor } from "@/lib/gallery";
import { formatViews } from "@/lib/instagram";

interface PackListProps {
  packs: SourceOut[];
  totalCount: number;
  activeId: string | undefined;
  onSelect: (sourceId: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
}

function PackRow({
  source,
  active,
  onSelect,
}: {
  source: SourceOut;
  active: boolean;
  onSelect: () => void;
}) {
  const thumbReady = isFileReady(source.variants[0] ?? {});
  const thumbUrl = thumbReady
    ? source.variants[0]?.look_var_url || source.poster_url
    : undefined;
  const pct = avgOriginalityPct(source);
  const delivered = filesReadyCount(source);

  return (
    <button type="button" className="gallery-pack-row" data-active={active} onClick={onSelect}>
      <div className="gallery-pack-row__thumb">
        {thumbUrl && (
          <PosterThumb src={thumbUrl} className="gallery-pack-row__thumb-img" fill />
        )}
      </div>
      <div className="gallery-pack-row__main">
        <div className="gallery-pack-row__name" title={source.filename}>
          {source.filename}
        </div>
        <div className="gallery-pack-row__meta">
          {packMetaLabel(source)}
          {delivered < source.requested ? ` · ${delivered}/${source.requested}` : ""}
          {source.insights_linked
            ? ` · ${source.insights_views == null ? "linked" : `${formatViews(source.insights_views)} views`}`
            : ""}
        </div>
      </div>
      {pct != null && (
        <div className="gallery-pack-row__pct" style={{ color: packOriginalityColor(pct) }}>
          {pct}%
        </div>
      )}
    </button>
  );
}

export function PackList({ packs, totalCount, activeId, onSelect, search, onSearchChange, loading }: PackListProps) {
  const visible = search.trim()
    ? packs.filter((p) => p.filename.toLowerCase().includes(search.trim().toLowerCase()))
    : packs;

  return (
    <aside className="gallery-packs" aria-label="Packs">
      <div className="gallery-packs__head">
        <span className="gallery-packs__label">Packs</span>
        <span className="gallery-packs__count">{totalCount}</span>
      </div>
      <label className="gallery-packs__search">
        <span className="material-symbols-rounded" aria-hidden="true">search</span>
        <input
          type="search"
          placeholder="Filter by source"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Filter by source"
        />
      </label>
      <div className="gallery-packs__list">
        {loading && <div className="gallery-packs__empty">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="gallery-packs__empty">
            {packs.length === 0 ? "No packs yet" : "No packs match that search"}
          </div>
        )}
        {!loading &&
          visible.map((source) => (
            <PackRow
              key={source.source_id}
              source={source}
              active={source.source_id === activeId}
              onSelect={() => onSelect(source.source_id)}
            />
          ))}
      </div>
    </aside>
  );
}
