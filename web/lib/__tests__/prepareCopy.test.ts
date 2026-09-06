import { describe, expect, it } from "vitest";
import {
  PREPARING_JOB_ID,
  captionCopiedLabel,
  captionCopyLabel,
  captionSaveLabel,
  captionSnippet,
  captionStatusHint,
  captionToggleHint,
  captionToggleLabel,
  hqPrepToggleHint,
  hqPrepToggleLabel,
  isPreparingJob,
  preparingHeadline,
  preparingSubcopy,
  wakingHeadline,
  wakingSlotLabel,
  wakingSubcopy,
  uniquenessCoverageChips,
  uniquenessCoverageSubcopy,
  uniquenessCustomerLabel,
  uniquenessPassHint,
  uniquenessPassPct,
} from "@/lib/prepareCopy";

describe("prepare copy", () => {
  it("names the early progress state", () => {
    expect(isPreparingJob(PREPARING_JOB_ID)).toBe(true);
    expect(isPreparingJob("abc")).toBe(false);
    expect(preparingHeadline()).toMatch(/preparing generation/i);
    expect(preparingSubcopy(0)).toMatch(/1–2 minutes/i);
    expect(preparingSubcopy(0)).toMatch(/elapsed/i);
    expect(preparingSubcopy(75)).toMatch(/1:15/);
    expect(wakingHeadline()).toMatch(/waking fast worker/i);
    expect(wakingSubcopy(8, "queued")).toMatch(/cold-start queue/i);
    expect(wakingSlotLabel()).toBe("waking");
  });

  it("asks for captions on Generate, not a separate bank UI", () => {
    expect(captionToggleLabel()).toMatch(/write captions/i);
    expect(captionToggleHint()).toMatch(/thumbnail/i);
    expect(captionToggleHint()).toMatch(/per source|each clip|source clip/i);
    expect(uniquenessCustomerLabel()).toBe("Originality");
  });

  it("names reconstruct-first as one GPU pass, then Fast — not an HQ 20-pack", () => {
    expect(hqPrepToggleLabel()).toMatch(/reconstruct first/i);
    expect(hqPrepToggleLabel()).toMatch(/HQ/i);
    expect(hqPrepToggleHint()).toMatch(/one GPU pass/i);
    expect(hqPrepToggleHint()).toMatch(/Fast/i);
    expect(hqPrepToggleHint()).not.toMatch(/20-pack/i);
    expect(hqPrepToggleHint()).not.toMatch(/lab only/i);
  });

  it("names Originality as pixel SSIM, not a platform check", () => {
    expect(uniquenessCoverageSubcopy()).toMatch(/pixel difference vs the original/i);
    expect(uniquenessCoverageSubcopy()).toMatch(/3 frames/i);
    expect(uniquenessCoverageSubcopy()).toMatch(/not a platform check/i);
    expect(uniquenessCoverageChips(0.5, null).map((c) => c.text)).toEqual([
      "Pixel · scored",
      "Visual copy-id · not scored",
      "Audio · not scored",
    ]);
  });

  it("explains the real ~38% pass line, not a 65% verified band", () => {
    expect(uniquenessPassPct()).toBe(38);
    expect(uniquenessPassHint()).toBe("38% = pass vs the source");
    expect(uniquenessPassHint()).not.toMatch(/verified/i);
    expect(uniquenessPassHint()).not.toMatch(/65%/);
  });

  it("names caption save and copy actions", () => {
    expect(captionSaveLabel()).toBe("Save caption");
    expect(captionCopyLabel()).toBe("Copy caption");
    expect(captionCopiedLabel()).toBe("Copied");
    expect(captionStatusHint()).toMatch(/copy pastes this caption/i);
    expect(captionStatusHint()).toMatch(/pass \/ flag/i);
    expect(captionStatusHint()).not.toMatch(/duplicate/i);
  });

  it("snips captions to a single-line preview", () => {
    expect(captionSnippet(null)).toBe("");
    expect(captionSnippet("  hello   world  ")).toBe("hello world");
    expect(captionSnippet("a".repeat(80))).toBe("a".repeat(80));
    expect(captionSnippet("a".repeat(81))).toBe(`${"a".repeat(79)}…`);
  });
});
