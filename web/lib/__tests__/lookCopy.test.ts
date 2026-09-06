import { describe, expect, it } from "vitest";
import {
  LOOK_LUMA_MAX,
  lookApproveLabel,
  lookApprovalValid,
  lookIsDeliverable,
  lookReviewBody,
  lookReviewTitle,
  normalizeLookStatus,
} from "@/lib/lookCopy";

describe("lookCopy", () => {
  it("keeps the MAE threshold at 38", () => {
    expect(LOOK_LUMA_MAX).toBe(38);
  });

  it("maps legacy ok/fail onto review vocabulary", () => {
    expect(normalizeLookStatus("ok")).toBe("no_coarse_luma_alarm");
    expect(normalizeLookStatus("fail")).toBe("review_required");
    expect(normalizeLookStatus("review_required")).toBe("review_required");
    expect(normalizeLookStatus("no_coarse_luma_alarm")).toBe("no_coarse_luma_alarm");
    expect(normalizeLookStatus("unknown")).toBe("unknown");
    expect(normalizeLookStatus(null)).toBe("unknown");
  });

  it("does not call a quiet MAE score realistic-looking", () => {
    expect(lookReviewTitle("no_coarse_luma_alarm")).toBeNull();
    expect(lookReviewBody("no_coarse_luma_alarm")).toBeNull();
    expect(lookIsDeliverable("no_coarse_luma_alarm")).toBe(true);
  });

  it("treats review_required as a trigger, not looks-bad, until checksum approval", () => {
    expect(lookReviewTitle("fail")).toBe("Review this encode");
    expect(lookReviewBody("review_required")).toMatch(/not a verdict that it looks bad/i);
    expect(lookReviewTitle("review_required")).not.toMatch(/looks bad/i);
    expect(lookIsDeliverable("review_required")).toBe(false);
    expect(lookIsDeliverable("review_required", "aaa", "aaa")).toBe(true);
    expect(lookIsDeliverable("review_required", "aaa", "bbb")).toBe(false);
    expect(lookApproveLabel()).toMatch(/approve this encode/i);
  });

  it("never marks unknown as look-approved", () => {
    expect(lookIsDeliverable("unknown")).toBe(false);
    expect(lookReviewTitle("unknown")).toMatch(/unavailable/i);
    expect(lookReviewBody("unknown")).toMatch(/not treat this as look-approved/i);
  });

  it("invalidates approval when the encode checksum changes", () => {
    expect(lookApprovalValid("abc", "abc")).toBe(true);
    expect(lookApprovalValid("abc", "def")).toBe(false);
    expect(lookApprovalValid("abc", null)).toBe(false);
  });
});
