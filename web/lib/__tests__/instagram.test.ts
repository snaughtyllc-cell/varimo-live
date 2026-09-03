import { describe, expect, it } from "vitest";
import {
  AMPLIFY_MORE_N,
  copiesForPack,
  copyPickerLabel,
  copyPickerOptions,
  formatCopyPick,
  formatViews,
  galleryViewsCopy,
  handleLabel,
  igOauthErrorMessage,
  insightSnapshotCopy,
  moveCopyLabel,
  packConversionCopy,
  packPickerOptions,
  packSuggestionHint,
  packViewsCopy,
  rankedOriginalPrefix,
  parseCopyPick,
  suggestionButtonLabel,
  syncInsightsCopy,
  trackedCopyLabel,
  trackedCopyMeta,
  unlinkCopyLabel,
  unmatchedCaptionPreview,
  unmatchedTabCopy,
  variantViewsCopy,
} from "@/lib/instagram";

describe("formatViews", () => {
  it("keeps unknown as an em dash", () => {
    expect(formatViews(null)).toBe("—");
  });

  it("compacts thousands", () => {
    expect(formatViews(312400)).toBe("312k");
    expect(formatViews(1500)).toBe("1.5k");
  });
});

describe("packViewsCopy", () => {
  it("hides when nothing is linked", () => {
    expect(packViewsCopy(0, 0, 20)).toBeNull();
  });

  it("does not treat unlinked packs as zero views", () => {
    expect(packViewsCopy(312400, 14, 20)).toBe("312k views · 14 of 20 linked");
  });
});

describe("galleryViewsCopy", () => {
  it("asks to connect on the Analytics tab when no accounts", () => {
    expect(galleryViewsCopy(null, 0, 0)).toMatch(/Connect Instagram testers on Analytics/i);
  });

  it("does not show a blank dash when copies are linked without counts", () => {
    expect(galleryViewsCopy(null, 14, 2)).toMatch(/14 linked posts/i);
    expect(galleryViewsCopy(null, 14, 2)).toMatch(/no view counts/i);
    expect(galleryViewsCopy(null, 14, 2)).not.toMatch(/^— views/i);
  });
});

describe("variantViewsCopy", () => {
  it("hides unlinked copies instead of showing zero", () => {
    expect(variantViewsCopy(0, false)).toBeNull();
  });

  it("compacts linked views", () => {
    expect(variantViewsCopy(312400, true)).toBe("312k");
  });
});

describe("packConversionCopy", () => {
  it("adds shares and follows when Graph sent them", () => {
    expect(packConversionCopy(312400, 80, 12, 14, 20)).toBe(
      "312k views · 80 shares · 12 follows · 14 of 20 linked",
    );
  });

  it("omits missing conversion metrics instead of writing zero", () => {
    expect(packConversionCopy(1500, null, undefined, 4, 8)).toBe("1.5k views · 4 of 8 linked");
  });
});

describe("insightSnapshotCopy", () => {
  it("joins the Insights snapshot without inventing flagged", () => {
    expect(insightSnapshotCopy({ views: 1500, likes: 12 })).toBe("1.5k views · 12 likes");
    expect(insightSnapshotCopy({ views: 1500, likes: 12 })).not.toMatch(/flagged/i);
  });

  it("lists follows, skip, and watch when present", () => {
    const copy = insightSnapshotCopy({
      views: 1500,
      follows: 3,
      reels_skip_rate: 0.62,
      ig_reels_avg_watch_time: 2100,
      video_duration: 10,
    });
    expect(copy).toMatch(/1\.5k views/);
    expect(copy).toMatch(/3 follows/);
    expect(copy).toMatch(/62% skip/);
    expect(copy).toMatch(/2\.1s watch/);
    expect(copy).not.toMatch(/flagged/i);
  });
});

describe("amplify count", () => {
  it("mints a Fast 20 of the winning original", () => {
    expect(AMPLIFY_MORE_N).toBe(20);
  });
});

describe("igOauthErrorMessage", () => {
  it("does not tell them to paste a Meta token", () => {
    expect(igOauthErrorMessage("exchange_failed")).not.toMatch(/paste/i);
  });
});

describe("syncInsightsCopy", () => {
  it("does not treat Graph-empty as matched zero Gallery copies", () => {
    expect(syncInsightsCopy({ matched: 0, accounts: 1, media: 0, unmatched: [] })).toMatch(
      /returned 0 Reels/i,
    );
    expect(syncInsightsCopy({ matched: 0, accounts: 1, media: 0, unmatched: [] })).not.toMatch(
      /^Matched 0 posts/i,
    );
  });

  it("says how many Reels Graph sent when auto-link misses", () => {
    expect(
      syncInsightsCopy({
        matched: 0,
        accounts: 1,
        media: 12,
        unmatched: [{ media_id: "orphan" }],
      }),
    ).toMatch(/Saw 12 Reels, matched 0/i);
    expect(
      syncInsightsCopy({
        matched: 0,
        accounts: 1,
        media: 12,
        unmatched: [{ media_id: "orphan" }],
      }),
    ).toMatch(/Unmatched tab/i);
  });

  it("says when matched Reels still have no view counts", () => {
    expect(
      syncInsightsCopy({
        matched: 3,
        accounts: 2,
        media: 12,
        unmatched: [],
        analytics: { insights_views: null, insights_linked: 3 },
      }),
    ).toMatch(/no view counts/i);
  });
});

describe("handleLabel", () => {
  it("prefixes at", () => {
    expect(handleLabel("maya.main")).toBe("@maya.main");
  });
});

describe("suggestionButtonLabel", () => {
  it("only puts Generate more on a winner", () => {
    expect(suggestionButtonLabel("winner")).toMatch(/Generate 20 more/i);
    expect(suggestionButtonLabel("quiet")).toBeNull();
    expect(suggestionButtonLabel("weak_hold")).toBeNull();
    expect(suggestionButtonLabel("held_no_push")).toBeNull();
  });
});

describe("packSuggestionHint", () => {
  it("is a compact Gallery chip, never flagged", () => {
    expect(packSuggestionHint("winner")).toBe("Winner");
    expect(packSuggestionHint("weak_hold")).toBe("Weak hold");
    expect(packSuggestionHint("held_no_push")).toBe("Held, little push");
    expect(packSuggestionHint("quiet")).toBe("Quiet — try a new original");
    expect(packSuggestionHint("weak_hold")).not.toMatch(/flagged/i);
    expect(packSuggestionHint("held_no_push")).not.toMatch(/flagged/i);
    expect(packSuggestionHint("quiet")).not.toMatch(/flagged/i);
    expect(packSuggestionHint(null)).toBeNull();
  });
});

describe("rankedOriginalPrefix", () => {
  it("labels hold vs push without calling flagged", () => {
    expect(rankedOriginalPrefix("winner")).toBe("Winner · ");
    expect(rankedOriginalPrefix("weak_hold")).toBe("Weak hold · ");
    expect(rankedOriginalPrefix("held_no_push")).toBe("Held, little push · ");
    expect(rankedOriginalPrefix("held_no_push")).not.toMatch(/flagged/i);
    expect(rankedOriginalPrefix(null)).toBe("");
  });
});

describe("trackedCopyMeta", () => {
  it("names the handle and flags a disconnected account", () => {
    expect(trackedCopyLabel(7)).toBe("copy 07");
    expect(unlinkCopyLabel(7)).toBe("Remove copy 07 from tracking");
    expect(moveCopyLabel(7)).toBe("Move copy 07 to another original");
    expect(trackedCopyMeta({
      username: "mckenzie.trial",
      account_connected: false,
      insights_views: 800,
    })).toBe("@mckenzie.trial · account not connected · 800 views");
    expect(trackedCopyMeta({
      username: "mckenzie.trial",
      account_connected: false,
      insights_views: 800,
    })).not.toMatch(/flagged/i);
    expect(trackedCopyMeta({
      username: "jeff",
      insights_views: null,
    })).toBe("@jeff · views unknown");
  });
});

describe("unmatched picker helpers", () => {
  it("truncates unmatched captions for the picker list", () => {
    expect(unmatchedCaptionPreview("short")).toBe("short");
    expect(unmatchedCaptionPreview("   ")).toBe("No caption");
    expect(unmatchedCaptionPreview("x".repeat(90)).endsWith("…")).toBe(true);
    expect(unmatchedCaptionPreview("x".repeat(90)).length).toBeLessThanOrEqual(80);
  });

  it("labels Gallery copies and round-trips the select value", () => {
    expect(copyPickerLabel("winner.mp4", 7, false)).toBe("winner.mp4 · copy 07");
    expect(copyPickerLabel("winner.mp4", 7, true)).toBe("winner.mp4 · copy 07 (linked)");
    expect(formatCopyPick("src", 3)).toBe("src:3");
    expect(parseCopyPick("src:3")).toEqual({ source_id: "src", index: 3 });
    expect(copyPickerOptions([
      {
        source_id: "s1",
        filename: "a.mp4",
        variants: [{ index: 1, ig_media_id: null }, { index: 2, ig_media_id: "m" }],
      },
    ]).map((row) => row.label)).toEqual([
      "a.mp4 · copy 01",
      "a.mp4 · copy 02 (linked)",
    ]);
  });

  it("lists Gallery packs first, then copies inside the chosen pack", () => {
    const sources = [
      {
        source_id: "s1",
        filename: "winner.mp4",
        variants: [{ index: 1, ig_media_id: null }, { index: 2, ig_media_id: "m" }],
      },
      {
        source_id: "s2",
        filename: "quiet.mp4",
        variants: [{ index: 1, ig_media_id: null }],
      },
    ];
    expect(packPickerOptions(sources).map((row) => row.label)).toEqual([
      "winner.mp4",
      "quiet.mp4",
    ]);
    expect(copiesForPack(sources, "s1").map((row) => row.label)).toEqual([
      "copy 01",
      "copy 02 (linked)",
    ]);
    expect(copiesForPack(sources, "missing")).toEqual([]);
  });
});

describe("unmatchedTabCopy", () => {
  it("says leftover Reels are older posts, not missing Gallery files", () => {
    expect(unmatchedTabCopy(12)).toMatch(/before Varimo/i);
    expect(unmatchedTabCopy(12)).toMatch(/12 unmatched/i);
    expect(unmatchedTabCopy(0)).toMatch(/No leftover Reels/i);
  });
});
