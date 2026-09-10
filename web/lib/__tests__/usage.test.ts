import { describe, expect, it } from "vitest";
import { memberWeekCopy, monthMeterCopy, PLAN_OPTIONS, remainingPct, sidebarUsage } from "@/lib/usage";

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

describe("sidebarUsage", () => {
  it("drains from 100 to 0 against included packs", () => {
    expect(remainingPct(0, 96)).toBe(100);
    expect(remainingPct(48, 96)).toBe(50);
    expect(remainingPct(96, 96)).toBe(0);
    expect(
      sidebarUsage({
        uncapped: false,
        used_variants: 0,
        included_variants: 96,
        included_packs: 12,
        remaining_pct: 100,
      }),
    ).toEqual({ pct: 100, label: "12 of 12 left", tone: "included" });
    expect(
      sidebarUsage({
        uncapped: false,
        used_variants: 96,
        included_variants: 96,
        included_packs: 12,
        remaining_pct: 0,
      }),
    ).toEqual({ pct: 0, label: "0 of 12 left", tone: "included" });
    expect(sidebarUsage({ uncapped: true, used_variants: 8, included_packs: 0 })).toEqual({
      pct: 100,
      label: "uncapped",
      tone: "included",
    });
    expect(
      sidebarUsage({
        uncapped: false,
        used_variants: 0,
        included_variants: 0,
        included_packs: 0,
      }),
    ).toBeNull();
  });

  it("drains Agency Fast hours and flips to Usage after the included block", () => {
    expect(
      sidebarUsage({
        uncapped: false,
        tone: "included",
        remaining_pct: 100,
        meter_line: "90 of 90h left",
        included_fast_hours: 90,
      }),
    ).toEqual({ pct: 100, label: "90 of 90h left", tone: "included" });
    expect(
      sidebarUsage({
        uncapped: false,
        tone: "included",
        remaining_pct: 0,
        meter_line: "0 of 90h left",
        included_fast_hours: 90,
      }),
    ).toEqual({ pct: 0, label: "0 of 90h left", tone: "included" });
    expect(
      sidebarUsage({
        uncapped: false,
        tone: "usage",
        remaining_pct: 0,
        meter_line: "Usage",
        included_fast_hours: 90,
      }),
    ).toEqual({ pct: 0, label: "Usage", tone: "usage" });
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
