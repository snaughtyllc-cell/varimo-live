import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "@/lib/clipboard";

describe("writeClipboardText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes non-empty text to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(writeClipboardText("POV boil\n#reels")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("POV boil\n#reels");
  });

  it("does not call the clipboard for empty text", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(writeClipboardText("")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("returns false when the clipboard API rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(writeClipboardText("POV boil")).resolves.toBe(false);
  });
});
