import { describe, it, expect } from "vitest";
import {
  exportProgressLabel,
  oauthErrorMessage,
  okVariantKeys,
  okVariantRefs,
  selectAllLabel,
  selectionHasAllOk,
  sendDisabledReason,
  truncateFolderId,
  withOkSelection,
} from "@/lib/drive";
import type { SourceOut } from "@/lib/types";

const sources: SourceOut[] = [{
  source_id: "s1", filename: "a.mp4", requested: 2, delivered: 1, shortfall: 1,
  variants: [
    { index: 1, filename: "v01.mp4", status: "ok", quality: {}, file_url: "/x" },
    { index: 2, filename: "v02.mp4", status: "best_effort", quality: {}, file_url: "/y" },
    { index: 3, filename: "v03.mp4", status: "uniqueness_fail", quality: {}, file_url: "/z" },
  ],
  failed: 1,
}];

describe("okVariantRefs", () => {
  it("keeps shipped selected (ok and best_effort)", () => {
    const sel = new Set(["s1:1", "s1:2"]);
    expect(okVariantRefs(sources, sel)).toEqual([
      { source_id: "s1", index: 1 },
      { source_id: "s1", index: 2 },
    ]);
  });

  it("includes caption when the variant has one", () => {
    const withCaption: SourceOut[] = [{
      source_id: "s1", filename: "a.mp4", requested: 1, delivered: 1, shortfall: 0,
      variants: [
        {
          index: 1,
          filename: "v01.mp4",
          status: "ok",
          quality: {},
          file_url: "/x",
          caption: "POV boil #reels",
        } as SourceOut["variants"][number],
      ],
    }];
    expect(okVariantRefs(withCaption, new Set(["s1:1"]))).toEqual([
      { source_id: "s1", index: 1, caption: "POV boil #reels" },
    ]);
  });
});

describe("select all ok variants", () => {
  it("skips ok variants whose files never copied back", () => {
    const mixed: SourceOut[] = [{
      source_id: "s1", filename: "a.mp4", requested: 2, delivered: 2, shortfall: 0,
      variants: [
        { index: 1, filename: "v01.mp4", status: "ok", quality: {}, file_url: "/x", file_ready: true },
        { index: 2, filename: "v02.mp4", status: "ok", quality: {}, file_url: "/y", file_ready: false },
      ],
    }];
    expect(okVariantKeys(mixed)).toEqual(["s1:1"]);
    expect(okVariantRefs(mixed, new Set(["s1:1", "s1:2"]))).toEqual([{ source_id: "s1", index: 1 }]);
  });

  it("selects every ok variant and deselects them", () => {
    const all = withOkSelection(new Set(), sources, true);
    expect([...all]).toEqual(["s1:1", "s1:2"]);
    expect(selectionHasAllOk(all, sources)).toBe(true);
    expect([...withOkSelection(all, sources, false)]).toEqual([]);
  });

  it("does not drop unrelated keys when deselecting a source", () => {
    const mixed = withOkSelection(new Set(["other:9"]), sources, true);
    expect(mixed.has("other:9")).toBe(true);
    const cleared = withOkSelection(mixed, sources, false);
    expect([...cleared]).toEqual(["other:9"]);
  });

  it("labels the toolbar action without a count", () => {
    expect(selectAllLabel(false, 20)).toBe("Select all");
    expect(selectAllLabel(true, 20)).toBe("Deselect all");
    expect(selectAllLabel(false, 0)).toBe("Select all");
    expect(selectAllLabel(true)).toBe("Deselect all");
  });
});

describe("truncateFolderId", () => {
  it("truncates long folder ids", () => {
    expect(truncateFolderId("1AbCdefghijk0123456789XYZ", 4)).toBe("1AbC…9XYZ");
  });
});

describe("sendDisabledReason", () => {
  it("blocks when not configured", () => {
    expect(sendDisabledReason(
      { status: "not_configured", sa_email: null, message: "Drive not connected — Connect Google in Settings" },
      [{ id: "dst_1", name: "R", folder_id: "f", auth_mode: "service_account" }],
      [{ source_id: "s1", index: 1 }],
    )).toMatch(/Connect Google|not configured/i);
  });
  it("blocks when no destinations", () => {
    expect(sendDisabledReason(
      { status: "ready", sa_email: "bot@x", message: "Drive ready" },
      [],
      [{ source_id: "s1", index: 1 }],
    )).toMatch(/destination/i);
  });
  it("blocks when no ok refs", () => {
    expect(sendDisabledReason(
      { status: "ready", sa_email: "bot@x", message: "Drive ready" },
      [{ id: "dst_1", name: "R", folder_id: "f", auth_mode: "service_account" }],
      [],
    )).toMatch(/ok variant/i);
  });
  it("allows when ready", () => {
    expect(sendDisabledReason(
      { status: "ready", sa_email: "bot@x", message: "Drive ready" },
      [{ id: "dst_1", name: "R", folder_id: "f", auth_mode: "service_account" }],
      [{ source_id: "s1", index: 1 }],
    )).toBeNull();
  });
});

describe("oauthErrorMessage", () => {
  it("explains exchange_failed", () => {
    expect(oauthErrorMessage("exchange_failed")).toMatch(/could not finish|token/i);
  });
  it("explains bad_state", () => {
    expect(oauthErrorMessage("bad_state")).toMatch(/try Connect Google again/i);
  });
  it("explains missing_code", () => {
    expect(oauthErrorMessage("missing_code")).toMatch(/callback|code/i);
  });
});

describe("exportProgressLabel", () => {
  it("counts finished and current", () => {
    expect(exportProgressLabel({
      files: [
        { status: "succeeded", filename: "v01.mp4" },
        { status: "uploading", filename: "v02.mp4" },
        { status: "pending", filename: "v03.mp4" },
      ],
    })).toEqual({ done: 1, total: 3, current: "v02.mp4" });
  });
});
