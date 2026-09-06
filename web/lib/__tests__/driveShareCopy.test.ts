import { describe, it, expect } from "vitest";
import {
  DEFAULT_DRIVE_SHARE_EMAIL,
  DRIVE_OPERATOR_WAIT,
  DRIVE_SHARE_BODY,
  DRIVE_SHARE_HEADING,
  driveShareEmail,
} from "@/lib/driveShareCopy";

describe("driveShareCopy", () => {
  it("defaults to the branded mailbox, not a personal inbox", () => {
    expect(DEFAULT_DRIVE_SHARE_EMAIL).toBe("drive@varyforge.app");
    expect(driveShareEmail(null)).toBe("drive@varyforge.app");
    expect(driveShareEmail("  ")).toBe("drive@varyforge.app");
    expect(driveShareEmail("ops@varyforge.app")).toBe("ops@varyforge.app");
    expect(DRIVE_SHARE_HEADING).toMatch(/share this email/i);
    expect(DRIVE_SHARE_BODY).toMatch(/Editor/i);
    expect(DRIVE_SHARE_BODY).toMatch(/paste the folder link/i);
    expect(DRIVE_OPERATOR_WAIT).toMatch(/only the site admin connects/i);
  });
});
