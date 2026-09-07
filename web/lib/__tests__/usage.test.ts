import { describe, expect, it } from "vitest";
import { memberWeekCopy, monthMeterCopy, PLAN_OPTIONS } from "@/lib/usage";

describe("memberWeekCopy", () => {
  it("says no packs when the operator has not generated this week", () => {
    expect(memberWeekCopy({})).toBe("This week: no packs");
    expect(memberWeekCopy({ week_fast: 0, week_hq: 0, week_packs: 0 })).toBe(
      "This week: no packs",
    );
  });

  it("shows Fast, HQ reconstructs, and pack count", () => {
    expect(
      memberWeekCopy({ week_fast: 5, week_hq: 1, week_packs: 2 }),
    ).toBe("This week: 5 Fast · 1 HQ · 2 packs");
    expect(
      memberWeekCopy({ week_fast: 3, week_hq: 0, week_packs: 1 }),
    ).toBe("This week: 3 Fast · 0 HQ · 1 pack");
  });
});

describe("PLAN_OPTIONS", () => {
  it("lists the four sell tiers plus Internal for Jeff", () => {
    expect(PLAN_OPTIONS.map((p) => p.id)).toEqual([
      "payg",
      "creator",
      "studio",
      "agency",
      "internal",
    ]);
    expect(PLAN_OPTIONS.map((p) => p.label)).toEqual([
      "Pay as you go",
      "Creator",
      "Studio",
      "Agency",
      "Internal (uncapped)",
    ]);
  });
});

describe("monthMeterCopy", () => {
  it("hides Internal and shows included packs for Creator", () => {
    expect(monthMeterCopy({ uncapped: true, meter_line: null })).toBeNull();
    expect(
      monthMeterCopy({
        uncapped: false,
        meter_line: "Creator · 2 of 12 packs this month",
      }),
    ).toBe("Creator · 2 of 12 packs this month");
  });
});
