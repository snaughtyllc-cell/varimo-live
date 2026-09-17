import { describe, it, expect } from "vitest";
import {
  DEFAULT_DRIVE_SHARE_EMAIL,
  DRIVE_OPERATOR_WAIT,
  DRIVE_SHARE_BODY,
  DRIVE_SHARE_HEADING,
  driveShareEmail,
} from "@/lib/driveShareCopy";

describe("driveShareCopy", () => {
  it("defaults to the studio mailbox, not a personal inbox", () => {
    expect(DEFAULT_DRIVE_SHARE_EMAIL).toBe("studio@varimo.io");
    expect(driveShareEmail(null)).toBe("studio@varimo.io");
    expect(driveShareEmail("  ")).toBe("studio@varimo.io");
    expect(driveShareEmail("ops@varimo.io")).toBe("ops@varimo.io");
    expect(DRIVE_SHARE_HEADING).toMatch(/share this email/i);
    expect(DRIVE_SHARE_BODY).toMatch(/Editor/i);
    expect(DRIVE_SHARE_BODY).toMatch(/paste.*folder link/i);
    expect(DRIVE_SHARE_BODY).toMatch(/only that folder/i);
    expect(DRIVE_SHARE_BODY).toMatch(/do not connect your own Google/i);
    expect(DRIVE_OPERATOR_WAIT).toMatch(/Editor/i);
    expect(DRIVE_OPERATOR_WAIT).toMatch(/this email|studio@/i);
    expect(DRIVE_OPERATOR_WAIT).toMatch(/paste/i);
    expect(DRIVE_OPERATOR_WAIT).toMatch(/site admin connects the studio mailbox/i);
    expect(DRIVE_OPERATOR_WAIT).not.toMatch(/connect your own/i);
  });
});
