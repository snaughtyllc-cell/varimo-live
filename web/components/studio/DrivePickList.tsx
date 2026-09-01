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
    <div className="studio-source-list">
      {picks.map((pick, i) => (
        <div key={`${pick.id}-${i}`} className="studio-source-row">
          <SourceThumb src={pick.thumbUrl} label="Drive" />
          <div className="studio-source-row__meta">
            <b>{pick.name}</b>
            <span>Google Drive</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="touch-hit studio-source-row__remove"
            aria-label={`Remove ${pick.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
