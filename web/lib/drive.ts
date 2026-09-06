import type { Destination, DriveStatus, ExportVariantRef, SourceOut } from "./types";

function captionOf(v: { caption?: string | null }): string | null | undefined {
  return v.caption;
}

export function okVariantRefs(sources: SourceOut[], selected: Set<string>): ExportVariantRef[] {
  const refs: ExportVariantRef[] = [];
  for (const source of sources) {
    for (const variant of source.variants) {
      if (variant.status !== "ok") continue;
      if (variant.file_ready === false) continue;
      if (!selected.has(`${source.source_id}:${variant.index}`)) continue;
      const caption = captionOf(variant)?.trim();
      refs.push({
        source_id: source.source_id,
        index: variant.index,
        ...(caption ? { caption } : {}),
      });
    }
  }
  return refs;
}

export function okVariantKeys(sources: SourceOut[]): string[] {
  const keys: string[] = [];
  for (const source of sources) {
    for (const variant of source.variants) {
      if (variant.status !== "ok") continue;
      if (variant.file_ready === false) continue;
      keys.push(`${source.source_id}:${variant.index}`);
    }
  }
  return keys;
}

export function selectionHasAllOk(selected: Set<string>, sources: SourceOut[]): boolean {
  const keys = okVariantKeys(sources);
  return keys.length > 0 && keys.every((k) => selected.has(k));
}

export function packActionSelected(source: SourceOut, selected: Set<string>): Set<string> {
  const keys = okVariantKeys([source]);
  const picked = keys.filter((key) => selected.has(key));
  return new Set(picked.length > 0 ? picked : keys);
}

export function withOkSelection(
  selected: Set<string>,
  sources: SourceOut[],
  select: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const key of okVariantKeys(sources)) {
    if (select) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function selectAllLabel(allSelected: boolean, _okCount?: number): string {
  return allSelected ? "Deselect all" : "Select all";
}

export function oauthErrorMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "exchange_failed":
      return "Google signed you in, but Studio could not finish the token exchange. Try Connect Google again.";
    case "bad_state":
      return "Sign-in expired or was interrupted. Try Connect Google again.";
    case "missing_code":
      return "Google came back without an auth code. Check the OAuth callback URL, then try Connect Google again.";
    default:
      return reason
        ? `Google sign-in failed (${reason}). Try Connect Google again.`
        : "Google sign-in failed. Try Connect Google again.";
  }
}

export function truncateFolderId(id: string, keep = 8): string {
  if (id.length <= keep * 2 + 1) return id;
  return `${id.slice(0, keep)}…${id.slice(-keep)}`;
}

export function sendDisabledReason(
  status: DriveStatus | null,
  destinations: Destination[],
  refs: ExportVariantRef[],
): string | null {
  if (!status || status.status !== "ready") {
    return status?.message ?? "Drive not configured on this Pod";
  }
  if (destinations.length === 0) {
    return "No Drive destinations saved";
  }
  if (refs.length === 0) {
    return "Select at least one ok variant";
  }
  return null;
}

export function exportProgressLabel(job: {
  files: { status: string; filename: string }[];
}): { done: number; total: number; current: string | null } {
  const total = job.files.length;
  const done = job.files.filter((f) => f.status === "succeeded" || f.status === "failed").length;
  const current = job.files.find((f) => f.status === "uploading")?.filename ?? null;
  return { done, total, current };
}
