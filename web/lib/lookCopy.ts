/** Look MAE vocabulary. Threshold stays 38 — change meaning, not the number. */

export const LOOK_LUMA_MAX = 38;

export type LookStatus = "no_coarse_luma_alarm" | "review_required" | "unknown";

export function normalizeLookStatus(status?: string | null): LookStatus {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "no_coarse_luma_alarm" || raw === "ok" || raw === "pass") {
    return "no_coarse_luma_alarm";
  }
  if (raw === "review_required" || raw === "fail") {
    return "review_required";
  }
  return "unknown";
}

export function lookApprovalValid(
  artifactSha?: string | null,
  approvedSha?: string | null,
): boolean {
  const art = String(artifactSha || "").trim();
  const appr = String(approvedSha || "").trim();
  return Boolean(art) && art === appr;
}

export function lookIsDeliverable(
  status?: string | null,
  artifactSha?: string | null,
  approvedSha?: string | null,
): boolean {
  const st = normalizeLookStatus(status);
  if (st === "unknown") return false;
  if (st === "no_coarse_luma_alarm") return true;
  return lookApprovalValid(artifactSha, approvedSha);
}

export function lookReviewTitle(status?: string | null): string | null {
  const st = normalizeLookStatus(status);
  if (st === "review_required") return "Review this encode";
  if (st === "unknown") return "Look score unavailable";
  return null;
}

export function lookReviewBody(status?: string | null): string | null {
  const st = normalizeLookStatus(status);
  if (st === "review_required") {
    return (
      "Coarse luma exceeded 38. That is a review trigger, not a verdict that it looks bad. "
      + "Play around the flagged moment. Approve this file if the crop looks fine — do not raise the threshold."
    );
  }
  if (st === "unknown") {
    return (
      "The output was missing or unreadable. Uniqueness is unchanged. "
      + "Do not treat this as look-approved or deliverable."
    );
  }
  return null;
}

export function lookApproveLabel(): string {
  return "Approve this encode";
}

export function lookApprovedLabel(): string {
  return "Approved for this checksum";
}

export function lookPlaybackLabel(): string {
  return "Play flagged moment";
}

export function lookStillsNote(): string {
  return "Stills are the oracle for those frames, not the whole clip.";
}
