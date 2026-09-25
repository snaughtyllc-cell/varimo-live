import { describe, it, expect, vi } from "vitest";
import {
  copyLandingCopy,
  copyMissingCopy,
  deliveryComplete,
  expiresLabel,
  filesReadyCount,
  filterSources,
  galleryRefreshMs,
  gallerySearchPath,
  missingCopySourceIds,
  isFileReady,
  packMetaLabel,
  packOriginalityColor,
  parseGalleryVariantQuery,
  pushGallerySearch,
  sortSources,
  tileOriginalityColor,
  zipEmptyCopy,
  removePackCopy,
} from "@/lib/gallery";
import { uniquenessPassPct } from "@/lib/prepareCopy";
const mk = (id: string, shortfall: number, created_utc = "") => ({
  source_id: id, filename: id, requested: 5, delivered: 5 - shortfall, shortfall,
  variants: [], created_utc,
});
describe("gallery helpers", () => {
  it("filter shortfall keeps only under-delivered", () => {
    const all = [mk("a", 0), mk("b", 2)];
    expect(filterSources(all, "shortfall").map(s => s.source_id)).toEqual(["b"]);
    expect(filterSources(all, "all").length).toBe(2);
  });
  it("filter shortfall also keeps packs whose files never copied back", () => {
    const all = [
      mk("a", 0),
      { ...mk("ghost", 0), copy_status: "missing" as const, files_ready: 0 },
    ];
    expect(filterSources(all, "shortfall").map(s => s.source_id)).toEqual(["ghost"]);
    expect(filterSources(all, "all").length).toBe(2);
  });
  it("sort newest uses created_utc, not filename", () => {
    const all = [
      { ...mk("apple", 0), created_utc: "2026-01-01T00:00:00Z" },
      { ...mk("zebra", 0), created_utc: "2026-08-18T12:00:00Z" },
    ];
    expect(sortSources(all, "newest").map(s => s.source_id)).toEqual(["zebra", "apple"]);
  });
  it("explains an empty zip as a missing download package, not a Files app glitch", () => {
    expect(zipEmptyCopy()).toMatch(/available for download/i);
  });

  it("does not treat metadata delivery as files on Studio", () => {
    const missing = {
      ...mk("ghost", 0),
      delivered: 5,
      files_ready: 0,
      copy_status: "missing" as const,
    };
    expect(filesReadyCount(missing)).toBe(0);
    expect(deliveryComplete(missing)).toBe(false);
    expect(copyMissingCopy()).toMatch(/Retry delivery/i);
    expect(copyLandingCopy()).toMatch(/landing/i);
  });

  it("formats download expiration without loading media", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    expect(expiresLabel("2026-09-05T15:42:00Z", now)).toMatch(/Expires/i);
    expect(expiresLabel("2026-09-04T11:00:00Z", now)).toBe("Downloads expired");
    expect(expiresLabel(null, now)).toBeNull();
  });

  it("explains removing a pack, including a live one", () => {
    expect(removePackCopy(false)).toMatch(/Gallery/i);
    expect(removePackCopy(true)).toMatch(/still generating/i);
    expect(removePackCopy(true)).toMatch(/everyone on this Studio/i);
  });

  it("treats omitted file_ready as present (older Studio payloads)", () => {
    expect(isFileReady({ file_url: "/x" } as never)).toBe(true);
    expect(isFileReady({ file_url: "/x", file_ready: false } as never)).toBe(false);
  });

  it("parses ?v=source:index from the Gallery address bar", () => {
    expect(parseGalleryVariantQuery("6bc8f627184a:3")).toEqual({
      sourceId: "6bc8f627184a",
      index: 3,
    });
    expect(parseGalleryVariantQuery("src:with:colon:2")).toEqual({
      sourceId: "src:with:colon",
      index: 2,
    });
    expect(parseGalleryVariantQuery("nope")).toBeNull();
    expect(parseGalleryVariantQuery(null)).toBeNull();
  });

  it("builds a Gallery path that can be pushed without a Next.js navigation", () => {
    expect(gallerySearchPath("abc", 3)).toBe("/gallery?v=abc:3");
    expect(gallerySearchPath()).toBe("/gallery");
  });

  it("labels a live empty 20-pack as generating, not 0 variants", () => {
    const now = new Date("2026-09-24T03:46:00Z");
    const live = {
      ...mk("saveinta", 20, "2026-09-24T03:40:00Z"),
      requested: 20,
      delivered: 0,
      files_ready: 0,
      job_state: "running",
    };
    expect(packMetaLabel(live, now)).toBe("Generating · 0/20 · today");
    expect(packMetaLabel(live, now)).not.toMatch(/0 variants/);
    expect(galleryRefreshMs([live])).toBe(4000);
  });

  it("polls while a scored pack is still missing its download package", () => {
    const missing = {
      ...mk("virgin", 0, "2026-09-25T18:28:00Z"),
      requested: 10,
      delivered: 10,
      files_ready: 0,
      copy_status: "missing" as const,
      job_state: "done",
      variants: Array.from({ length: 10 }, (_, i) => ({ index: i + 1 })),
    };
    expect(galleryRefreshMs([missing])).toBe(4000);
    expect(missingCopySourceIds([missing], new Set())).toEqual(["virgin"]);
    expect(missingCopySourceIds([missing], new Set(["virgin"]))).toEqual([]);
  });

  it("labels a finished empty 20-pack as didn't finish", () => {
    const now = new Date("2026-09-24T03:46:00Z");
    const dead = {
      ...mk("saveinta", 20, "2026-09-24T03:40:00Z"),
      requested: 20,
      delivered: 0,
      files_ready: 0,
      job_state: "done",
    };
    expect(packMetaLabel(dead, now)).toBe("Didn't finish · 0/20 · today");
    expect(galleryRefreshMs([dead])).toBe(0);
  });

  it("keeps a finished full pack as N variants · today", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const full = {
      ...mk("winner", 0, "2026-09-24T11:00:00Z"),
      requested: 20,
      delivered: 20,
      files_ready: 20,
      variants: Array.from({ length: 20 }, (_, i) => ({ index: i + 1 })),
      job_state: "done",
    };
    expect(packMetaLabel(full as never, now)).toBe("20 variants · today");
  });

  it("colors originality from the 38% pass line, not a 65% verified band", () => {
    expect(uniquenessPassPct()).toBe(38);
    expect(tileOriginalityColor(null)).toBe("var(--color-muted2)");
    expect(tileOriginalityColor(37)).toBe("var(--color-amber2)");
    expect(tileOriginalityColor(38)).toBe("var(--color-mint)");
    expect(tileOriginalityColor(52)).toBe("var(--color-mint)");
    expect(tileOriginalityColor(64)).toBe("var(--color-mint)");
    expect(packOriginalityColor(null)).toBe("var(--color-muted2)");
    expect(packOriginalityColor(37)).toBe("var(--color-amber)");
    expect(packOriginalityColor(38)).toBe("var(--color-violet)");
  });

  it("writes the Gallery query with history.pushState, not a page remount", () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    pushGallerySearch("/gallery?v=abc:3");
    expect(pushState).toHaveBeenCalledWith(null, "", "/gallery?v=abc:3");
    pushState.mockRestore();
  });
});
