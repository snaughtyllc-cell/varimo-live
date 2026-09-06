import { describe, it, expect } from "vitest";
import {
  DEFAULT_PER_VIDEO,
  MAX_PER_VIDEO,
  SPEED_TEST_PER_VIDEO,
  VARIANT_COUNT_PRESETS,
  generatePackLabel,
  variantPresetLabel,
  variantStepperHint,
} from "@/lib/variantStepperCopy";

describe("variantStepperCopy", () => {
  it("defaults Fast packs to 20", () => {
    expect(DEFAULT_PER_VIDEO).toBe(20);
    expect(MAX_PER_VIDEO).toBeGreaterThanOrEqual(20);
    expect(SPEED_TEST_PER_VIDEO).toBe(3);
    expect(VARIANT_COUNT_PRESETS).toEqual([3, 10, 20]);
    expect(variantPresetLabel(20)).toBe("20");
    expect(variantPresetLabel(20)).not.toMatch(/usual/i);
  });

  it("on Fast, says 20 encodes and a 3-clip speed test", () => {
    const hint = variantStepperHint("fast");
    expect(hint).toMatch(/20 on the GPU/i);
    expect(hint).toMatch(/tap − to 3/i);
    expect(hint).toMatch(/speed test/i);
    expect(hint).toMatch(/studio/i);
    expect(hint).not.toMatch(/kill/i);
  });

  it("is silent on HQ (throughput copy lives elsewhere)", () => {
    expect(variantStepperHint("hq")).toBeNull();
  });

  it("labels Generate as clips → variants so 1 file is not read as 1 encode", () => {
    expect(generatePackLabel(0, 20)).toBe("20 variants each");
    expect(generatePackLabel(1, 20)).toBe("1 clip → 20 variants");
    expect(generatePackLabel(1, 3)).toBe("1 clip → 3 variants");
    expect(generatePackLabel(5, 20)).toBe("5 clips → 100 variants");
  });
});
