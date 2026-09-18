import { describe, expect, it } from "vitest";
import { HOW_TO_CATEGORIES, HOW_TO_FORBIDDEN, howToPlainText } from "../howTo";

describe("howTo copy", () => {
  it("is three categories: Generating, Automation, Posting", () => {
    const text = howToPlainText();
    expect(HOW_TO_CATEGORIES.map((category) => category.id)).toEqual([
      "generating",
      "automation",
      "posting",
    ]);
    expect(HOW_TO_CATEGORIES[0].topics.map((topic) => topic.id)).toEqual([
      "original",
      "studio-gallery",
      "look",
    ]);
    expect(text).toMatch(/Start from the original/);
    expect(text).toMatch(/do not run a finished copy/i);
    expect(text).toMatch(/Studio → Gallery/);
    expect(text).toMatch(/output folder/);
    expect(text).toMatch(/Don't send/);
    expect(text).toMatch(/Check the look/);
    expect(text).toMatch(/Drive in, Drive out/);
    expect(text).toMatch(/Drive filenames/);
    expect(text).toMatch(/Plugins like Repurpose\.io and Buffer use the Drive filename/);
    expect(text).toMatch(/Plugins/);
    expect(text).not.toMatch(/caption bank/i);
    expect(text).not.toMatch(/we do not run those seats/i);
    expect(text).not.toMatch(/\bweekly\b/i);
    expect(text).toMatch(/do not drop every copy on every account at the same time/i);
    expect(text).toMatch(/Trial Reels/);
    expect(text).not.toMatch(/Analytics/i);
    expect(text).not.toMatch(/tester/i);
    expect(text).not.toMatch(/Reconstruct first/i);
    expect(text).not.toMatch(/Convert only/i);
  });

  it("does not publish fingerprint internals", () => {
    const text = howToPlainText();
    for (const pattern of HOW_TO_FORBIDDEN) {
      expect(text).not.toMatch(pattern);
    }
  });
});
