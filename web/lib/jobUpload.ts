export type JobUploadPhase = "direct" | "chunk" | "create";

export interface JobUploadProgress {
  phase: JobUploadPhase;
  fileIndex: number;
  fileCount: number;
  filename: string;
  loaded: number;
  total: number;
}

export function uploadProgressCopy(p: JobUploadProgress): string {
  if (p.phase === "create") return "Starting the pack on the engine…";
  if (p.fileCount <= 0) return "Uploading…";
  const pct = p.total > 0 ? Math.min(99, Math.round((p.loaded / p.total) * 100)) : 0;
  return `Uploading ${p.fileIndex + 1} of ${p.fileCount} · ${pct}%`;
}

export function uploadTileLabel(p: JobUploadProgress | null | undefined): string {
  if (!p || p.phase === "create") return "starting";
  return "uploading";
}

export function uploadBusyTitle(p: JobUploadProgress | null | undefined): string | undefined {
  if (!p) return undefined;
  if (p.phase === "create") return "Starting…";
  return "Uploading…";
}
