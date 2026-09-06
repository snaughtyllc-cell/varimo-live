import { afterEach, describe, expect, it, vi } from "vitest";
import { captureVideoPoster } from "@/lib/videoPoster";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureVideoPoster", () => {
  it("draws a jpeg once the offscreen video can paint a frame", async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,frame");
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: string | ElementCreationOptions) => {
      const el = originalCreate(tag, options as ElementCreationOptions);
      if (tag === "video") {
        Object.defineProperty(el, "videoWidth", { configurable: true, get: () => 1080 });
        Object.defineProperty(el, "videoHeight", { configurable: true, get: () => 1920 });
        Object.defineProperty(el, "duration", { configurable: true, get: () => 4 });
        let src = "";
        Object.defineProperty(el, "src", {
          configurable: true,
          get: () => src,
          set: (value: string) => {
            src = value;
            queueMicrotask(() => {
              el.dispatchEvent(new Event("loadeddata"));
              queueMicrotask(() => el.dispatchEvent(new Event("seeked")));
            });
          },
        });
      }
      if (tag === "canvas") {
        Object.defineProperty(el, "getContext", {
          value: () => ({ drawImage }),
        });
        Object.defineProperty(el, "toDataURL", { value: toDataURL });
      }
      return el;
    });
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => "blob:poster");
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = vi.fn();
    }

    const file = new File(["x"], "gym.mp4", { type: "video/mp4" });
    await expect(captureVideoPoster(file, 500)).resolves.toBe("data:image/jpeg;base64,frame");
    expect(drawImage).toHaveBeenCalled();
  });
});
