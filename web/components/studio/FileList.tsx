"use client";
import { formatDuration } from "@/lib/format";
import { SourceThumb } from "./SourceThumb";

interface FileListProps {
  files: File[];
  durations: number[];
  onRemove: (index: number) => void;
}

export function FileList({ files, durations, onRemove }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <>
      {files.map((file, i) => (
        <div className="studio-clip-card" key={`${file.name}-${i}`}>
          <div className="studio-clip-card__thumb">
            <SourceThumb file={file} label={file.name} />
          </div>
          <div className="studio-clip-card__meta">
            <span className="studio-clip-card__name">{file.name}</span>
            <span className="studio-clip-card__sub">
              {durations[i] != null ? formatDuration(durations[i]) : "…"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="studio-clip-card__remove touch-hit"
            aria-label={`Remove ${file.name}`}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>
      ))}
    </>
  );
}
