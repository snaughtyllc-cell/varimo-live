import { describe, expect, it } from "vitest";
import {
  PREPARING_JOB_ID,
  captionPromptLabel,
  captionPromptPlaceholder,
  captionSnippet,
  captionToggleHint,
  captionToggleLabel,
  isPreparingJob,
  preparingHeadline,
  preparingSubcopy,
  uniquenessCustomerLabel,
  uniquenessCoverageChips,
  uniquenessCoverageSubcopy,
  uniquenessGalleryBadgeTitle,
} from "@/lib/prepareCopy";

describe("prepare copy", () => {
  it("names the early progress state", () => {
    expect(isPreparingJob(PREPARING_JOB_ID)).toBe(true);
    expect(isPreparingJob("abc")).toBe(false);
    expect(preparingHeadline()).toMatch(/preparing generation/i);
    expect(preparingSubcopy()).toMatch(/20–30 seconds/i);
    expect(preparingSubcopy()).toMatch(/request received/i);
  });

  it("asks for captions on Generate, not a separate bank UI", () => {
    expect(captionToggleLabel()).toMatch(/write captions/i);
    expect(captionToggleHint()).toMatch(/opens a box/i);
    expect(captionPromptLabel()).toMatch(/caption for these copies/i);
    expect(captionPromptPlaceholder()).toMatch(/caption you want/i);
    expect(uniquenessCustomerLabel()).toBe("Originality");
  });

  it("says Originality is 3-frame pixel SSIM, not a platform check", () => {
    expect(uniquenessCoverageSubcopy()).toMatch(/3 frames/i);
    expect(uniquenessCoverageSubcopy()).toMatch(/not a platform check/i);
    expect(uniquenessGalleryBadgeTitle(38)).toMatch(/pixel SSIM/i);
    expect(uniquenessGalleryBadgeTitle(38)).toMatch(/not a platform pass/i);
    const chips = uniquenessCoverageChips(0.5, null);
    expect(chips.map((c) => c.kind)).toEqual(["pixel", "visual", "audio"]);
    expect(chips[0].state).toBe("scored");
    expect(chips[1].state).toBe("not_scored");
    expect(chips[2].state).toBe("not_scored");
  });

  it("snips captions to a single-line preview", () => {
    expect(captionSnippet(null)).toBe("");
    expect(captionSnippet("  hello   world  ")).toBe("hello world");
    expect(captionSnippet("a".repeat(80))).toBe("a".repeat(80));
    expect(captionSnippet("a".repeat(81))).toBe(`${"a".repeat(79)}…`);
  });
});
