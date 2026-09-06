/** Operator Drive setup: share a branded mailbox, then paste the folder link. */

export const DEFAULT_DRIVE_SHARE_EMAIL = "drive@varyforge.app";

export function driveShareEmail(statusEmail?: string | null): string {
  const raw = (statusEmail || "").trim();
  return raw || DEFAULT_DRIVE_SHARE_EMAIL;
}

export const DRIVE_SHARE_HEADING = "Share this email";

export const DRIVE_SHARE_BODY =
  "Add this address as Editor on the Google Drive folder you want for import and export. Then paste the folder link below.";

export const DRIVE_OPERATOR_WAIT =
  "Share the folder as Editor with this email, then paste the link. Only the site admin connects the studio Google account.";
