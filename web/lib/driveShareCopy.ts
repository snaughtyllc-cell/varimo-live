/** Operator Drive setup: share a branded mailbox, then paste the folder link. */

export const DEFAULT_DRIVE_SHARE_EMAIL = "drive@varyforge.app";

export function driveShareEmail(statusEmail?: string | null): string {
  const raw = (statusEmail || "").trim();
  return raw || DEFAULT_DRIVE_SHARE_EMAIL;
}

export const DRIVE_SHARE_HEADING = "Share this email";

export const DRIVE_SHARE_BODY =
  "Share your folder as Editor with this address, then paste the folder link below. We attach only that folder — not every folder shared with the studio.";

export const DRIVE_OPERATOR_WAIT =
  "Share your folder as Editor with this email, then paste that folder's link. Only the site admin connects the studio Google account.";
