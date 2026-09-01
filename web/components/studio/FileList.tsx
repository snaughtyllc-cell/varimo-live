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
    <div className="studio-source-list">
      {files.map((file, i) => (
        <div key={`${file.name}-${file.size}-${i}`} className="studio-source-row">
          <SourceThumb file={file} />
          <div className="studio-source-row__meta">
            <b>{file.name}</b>
            <span>{durations[i] != null ? formatDuration(durations[i]) : "…"}</span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="touch-hit studio-source-row__remove"
            aria-label={`Remove ${file.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
