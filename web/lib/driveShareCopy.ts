/** Operator Drive setup: share the studio mailbox, then paste the folder link. */

export const DEFAULT_DRIVE_SHARE_EMAIL = "studio@varimo.io";

export function driveShareEmail(statusEmail?: string | null): string {
  const raw = (statusEmail || "").trim();
  return raw || DEFAULT_DRIVE_SHARE_EMAIL;
}

export const DRIVE_SHARE_HEADING = "Share this email";

export const DRIVE_SHARE_BODY =
  "Share the folder as Editor with this address, then paste that folder link. We attach only that folder. Do not connect your own Google.";

export const DRIVE_OPERATOR_WAIT =
  "Share the folder as Editor with this email, then paste the folder link. Site admin connects the studio mailbox.";
