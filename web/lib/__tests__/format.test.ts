import { describe, it, expect } from "vitest";
import {
  formatDuration,
  vmafPass,
  diagnosticsReason,
  similarityFromUniqueness,
  pct01,
  ESCALATED_BADGE,
  ESCALATED_TITLE,
} from "@/lib/format";

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(18)).toBe("0:18");
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(95)).toBe("1:35");
  });
});

describe("vmafPass", () => {
  it("passes at or above floor 90", () => {
    expect(vmafPass(90)).toBe(true);
    expect(vmafPass(84.2)).toBe(false);
  });
});

describe("similarityFromUniqueness", () => {
  it("mirrors uniqueness on the SSIM-bits scale", () => {
    // Similarity is 1 − uniqueness on the same SSIM-bits scale.
    expect(similarityFromUniqueness(24 / 64)).toBeCloseTo(40 / 64);
    expect(similarityFromUniqueness(0.5)).toBe(0.5);
    expect(pct01(similarityFromUniqueness(0.5))).toBe(50);
    expect(pct01(0.5)).toBe(50); // uniqueness % (higher better)
  });
});

describe("escalated copy", () => {
  it("labels a uniqueness pass, not a fail", () => {
    expect(ESCALATED_BADGE).toBe("esc");
    expect(ESCALATED_TITLE.toLowerCase()).toContain("not a fail");
    expect(ESCALATED_TITLE.toLowerCase()).toContain("original");
    expect(ESCALATED_TITLE).toMatch(/38%/);
    expect(ESCALATED_TITLE).toMatch(/After that hunt/);
    expect(ESCALATED_TITLE).toMatch(/30%/);
    expect(ESCALATED_TITLE).toMatch(/55/);
    expect(ESCALATED_TITLE).toMatch(/65/);
  });
});

describe("diagnosticsReason", () => {
  const q = (over: Partial<any>) => ({ vmaf: 84.2, histogram_ok: true, regen_count: 3, passed: false, spatial_vmaf: null, spatial_ok: null, ...over });
  it("below-floor reason carries the vmaf metric", () => {
    const r = diagnosticsReason({ source_id: "s", index: 19, filename: "v19.mp4", status: "best_effort", quality: q({}) });
    expect(r.corrupt).toBe(false);
    expect(r.metric).toContain("84.2");
    expect(r.metric).toContain("90");
  });
  it("marks uniqueness_fail as a ship miss, not a Drive file", () => {
    const r = diagnosticsReason({
      source_id: "s", index: 3, filename: "v03.mp4", status: "uniqueness_fail",
      quality: q({ vmaf: 96, passed: true, bits: 12 }),
    });
    expect(r.corrupt).toBe(false);
    expect(r.title.toLowerCase()).toContain("couldn't unique");
    expect(r.metric).toContain("12");
    expect(r.metric).toContain("30%");
  });
  it("corrupt reason carries the spatial metric", () => {
    const r = diagnosticsReason({ source_id: "s", index: 7, filename: "v07.mp4", status: "corrupt", quality: q({ passed: false, spatial_ok: false, spatial_vmaf: 22.0 }) });
    expect(r.corrupt).toBe(true);
    expect(r.metric).toContain("22");
  });
});
