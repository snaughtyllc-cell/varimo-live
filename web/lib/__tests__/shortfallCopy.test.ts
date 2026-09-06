import { describe, it, expect } from "vitest";
import { shortfallCopy } from "@/lib/shortfallCopy";
import { SourceOut } from "@/lib/types";

const base = (over: Partial<SourceOut> = {}): SourceOut => ({
  source_id: "s",
  filename: "a.mp4",
  requested: 5,
  delivered: 2,
  shortfall: 3,
  failed: 0,
  job_state: "done",
  variants: [],
  ...over,
});

describe("shortfallCopy", () => {
  it("returns null when fully delivered", () => {
    expect(shortfallCopy(base({ shortfall: 0, delivered: 5 }))).toBeNull();
  });

  it("says still rendering while job is running", () => {
    const msg = shortfallCopy(base({ job_state: "running", failed: 0 }));
    expect(msg).toMatch(/still rendering/i);
    expect(msg).not.toMatch(/Diagnostics/i);
  });

  it("says still rendering while job is queued", () => {
    const msg = shortfallCopy(base({ job_state: "queued", failed: 0 }));
    expect(msg).toMatch(/still rendering/i);
  });

  it("does not send operators to Diagnostics when variants failed", () => {
    const msg = shortfallCopy(base({ job_state: "done", failed: 2, shortfall: 2 }));
    expect(msg).toMatch(/regenerat/i);
    expect(msg).not.toMatch(/Diagnostics/i);
  });

  it("says missing (not Diagnostics) when shortfall with zero failed", () => {
    const msg = shortfallCopy(base({ job_state: "done", failed: 0, shortfall: 3 }));
    expect(msg).toMatch(/missing|not delivered/i);
    expect(msg).not.toMatch(/Diagnostics/i);
  });
});
