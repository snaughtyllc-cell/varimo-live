import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "@/lib/clipboard";

describe("writeClipboardText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
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
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no textarea");
      },
    });
    await expect(writeClipboardText("POV boil")).resolves.toBe(false);
  });

  it("prefers execCommand so a dialog click still copies", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    document.execCommand = vi.fn().mockReturnValue(true);
    await expect(writeClipboardText("POV boil")).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when writeText is missing", async () => {
    const exec = vi.fn().mockReturnValue(true);
    const el = {
      value: "",
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    vi.stubGlobal("navigator", { clipboard: undefined });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(el),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: exec,
    });
    await expect(writeClipboardText("POV boil")).resolves.toBe(true);
    expect(el.value).toBe("POV boil");
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("removes the fallback textarea when execCommand is missing", async () => {
    const removeChild = vi.fn();
    const el = {
      value: "",
      setAttribute: vi.fn(),
      style: {} as CSSStyleDeclaration,
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      parentNode: { removeChild },
    };
    vi.stubGlobal("navigator", { clipboard: undefined });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(el),
      body: { appendChild: vi.fn(), removeChild },
    });
    await expect(writeClipboardText("POV boil")).resolves.toBe(false);
    expect(removeChild).toHaveBeenCalledWith(el);
  });
});
