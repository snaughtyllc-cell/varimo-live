import { describe, it, expect } from "vitest";
import {
  DEFAULT_PER_VIDEO,
  MAX_PER_VIDEO,
  generatePackLabel,
  variantStepperHint,
} from "@/lib/variantStepperCopy";

describe("variantStepperCopy", () => {
  it("defaults packs to 8", () => {
    expect(DEFAULT_PER_VIDEO).toBe(8);
    expect(MAX_PER_VIDEO).toBeGreaterThanOrEqual(8);
  });

  it("does not put GPU or speed-test copy on the stepper", () => {
    expect(variantStepperHint("fast")).toBeNull();
    expect(variantStepperHint("hq")).toBeNull();
  });

  it("labels Generate as N variants each", () => {
    expect(generatePackLabel(0, 8)).toBe("8 variants each");
    expect(generatePackLabel(1, 8)).toBe("8 variants each");
    expect(generatePackLabel(5, 8)).toBe("8 variants each");
    expect(generatePackLabel(1, 3)).toBe("3 variants each");
  });
});
