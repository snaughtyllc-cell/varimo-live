"use client";
import type { DrivePick } from "./DrivePickerModal";
import { SourceThumb } from "./SourceThumb";

interface DrivePickListProps {
  picks: DrivePick[];
  onRemove: (index: number) => void;
}

export function DrivePickList({ picks, onRemove }: DrivePickListProps) {
  if (picks.length === 0) return null;

  return (
    <>
      {picks.map((pick, i) => (
        <div className="studio-clip-card" key={`${pick.id}-${i}`}>
          <div className="studio-clip-card__thumb">
            <SourceThumb label={pick.name} />
          </div>
          <div className="studio-clip-card__meta">
            <span className="studio-clip-card__name">{pick.name}</span>
            <span className="studio-clip-card__sub">Google Drive</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="studio-clip-card__remove touch-hit"
            aria-label={`Remove ${pick.name}`}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
      ))}
    </>
  );
}
