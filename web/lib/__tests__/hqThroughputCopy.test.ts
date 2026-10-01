import { describe, it, expect } from "vitest";
import { hqBatchHint } from "@/lib/hqThroughputCopy";

describe("hqBatchHint", () => {
  it("is silent on Fast", () => {
    expect(hqBatchHint("fast", 20)).toBeNull();
  });

  it("warns that a 20-count HQ batch is serial and 25-minute capped", () => {
    const h = hqBatchHint("hq", 20);
    expect(h).toMatch(/20 HQ/);
    expect(h).toMatch(/one after another/i);
    expect(h).toMatch(/Fast/);
    expect(h).toMatch(/25 minutes/);
  });

  it("still names the serial wait on a small HQ batch", () => {
    const h = hqBatchHint("hq", 2);
    expect(h).toMatch(/several minutes per variant/i);
    expect(h).not.toMatch(/kills a job/);
  });
});
