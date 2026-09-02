import { describe, expect, it } from "vitest";
import {
  PREPARING_JOB_ID,
  captionCopyBlockedCopy,
  captionCopyLabel,
  captionCopiedLabel,
  captionEmptyCopy,
  captionNeedSourcesCopy,
  captionPromptLabel,
  captionPromptLabelForSource,
  captionPromptPlaceholder,
  captionSaveLabel,
  captionSnippet,
  captionStatusHint,
  captionToggleHint,
  captionToggleLabel,
  isPreparingJob,
  preparingHeadline,
  preparingSubcopy,
  stripInternalIndexLines,
  uniquenessCustomerLabel,
  uniquenessCoverageChips,
  uniquenessCoverageSubcopy,
  uniquenessGalleryBadgeTitle,
  packCaptionSeed,
  packOptionsLabel,
  rewriteCaptionsLabel,
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
    expect(captionToggleHint()).toMatch(/thumbnail/i);
    expect(captionToggleHint()).toMatch(/per source|each clip|source clip/i);
    expect(captionPromptLabel()).toMatch(/caption for this clip/i);
    expect(captionPromptPlaceholder()).toMatch(/this clip/i);
    expect(captionPromptLabelForSource(0, 4)).toMatch(/source 1 of 4/i);
    expect(captionNeedSourcesCopy()).toMatch(/add videos first/i);
    expect(uniquenessCustomerLabel()).toBe("Originality");
  });

  it("lets Gallery edit captions without tying status to Instagram copy", () => {
    expect(captionSaveLabel()).toMatch(/save caption/i);
    expect(captionCopyLabel()).toMatch(/^copy caption$/i);
    expect(captionCopiedLabel()).toMatch(/^copied$/i);
    expect(captionCopyBlockedCopy()).toMatch(/clipboard blocked/i);
    expect(captionEmptyCopy()).toMatch(/no caption/i);
    expect(captionStatusHint()).toMatch(/before/i);
    expect(captionStatusHint()).toMatch(/instagram/i);
    expect(captionStatusHint()).toMatch(/video/i);
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

  it("strips Copy N of M lines from captions and Drive filenames", () => {
    expect(stripInternalIndexLines("POV boil\n\nCopy 1 of 20\n#reels")).toBe("POV boil\n\n#reels");
    expect(stripInternalIndexLines("Gym pull\nTake 2 of 8\n#fyp")).toBe("Gym pull\n#fyp");
    expect(captionSnippet("POV boil\n\nCopy 1 of 20\n#reels")).toBe("POV boil #reels");
  });

  it("names Gallery pack Options for rewriting captions", () => {
    expect(packOptionsLabel()).toMatch(/options/i);
    expect(rewriteCaptionsLabel()).toMatch(/rewrite captions/i);
    expect(packCaptionSeed({ caption_prompt: "POV boil #reels" })).toBe("POV boil #reels");
    expect(packCaptionSeed({
      variants: [{ caption: "Gym pump\n\nCopy 1 of 8\n#fyp" }],
    })).toBe("Gym pump\n\n#fyp");
  });
});
