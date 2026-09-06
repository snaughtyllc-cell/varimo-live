import { describe, it, expect } from "vitest";
import { clipInset, clampTime, compareSliderWidth, cssAspectRatio, previewTime, videoFrameSrc } from "@/lib/media";
describe("media helpers", () => {
  it("clipInset maps percent to inset", () => {
    expect(clipInset(54)).toBe("inset(0 46% 0 0)");
    expect(clipInset(0)).toBe("inset(0 100% 0 0)");
  });
  it("clampTime clamps to [0,duration]", () => {
    expect(clampTime(-1, 10)).toBe(0);
    expect(clampTime(5, 10)).toBe(5);
    expect(clampTime(99, 10)).toBe(10);
    expect(clampTime(5, 0)).toBe(0);
  });
});

describe("cssAspectRatio", () => {
  it("keeps portrait 1080×1920 as 1080 / 1920", () => {
    expect(cssAspectRatio(1080, 1920)).toBe("1080 / 1920");
  });

  it("keeps landscape 1920×1080 as 1920 / 1080", () => {
    expect(cssAspectRatio(1920, 1080)).toBe("1920 / 1080");
  });

  it("falls back to 9 / 16 when size is missing or invalid", () => {
    expect(cssAspectRatio(0, 1080)).toBe("9 / 16");
    expect(cssAspectRatio(1920, 0)).toBe("9 / 16");
    expect(cssAspectRatio(null, 1080)).toBe("9 / 16");
    expect(cssAspectRatio(1920, null)).toBe("9 / 16");
    expect(cssAspectRatio(null, null)).toBe("9 / 16");
    expect(cssAspectRatio()).toBe("9 / 16");
  });

  it("rounds fractional pixel sizes", () => {
    expect(cssAspectRatio(1919.6, 1080.4)).toBe("1920 / 1080");
  });
});

describe("compareSliderWidth", () => {
  it("scales 46dvh by the parsed aspect", () => {
    expect(compareSliderWidth("9 / 16")).toBe("min(100%, calc(46dvh * 9 / 16))");
    expect(compareSliderWidth("1920 / 1080")).toBe("min(100%, calc(46dvh * 1920 / 1080))");
  });

  it("falls back to 9:16 when the aspect string is unusable", () => {
    expect(compareSliderWidth("nope")).toBe("min(100%, calc(46dvh * 9 / 16))");
  });
});

describe("mobile first-frame helpers", () => {
  it("adds a media fragment so Safari can paint a frame", () => {
    expect(videoFrameSrc("/api/variants/s1/v01.mp4")).toBe("/api/variants/s1/v01.mp4#t=0.15");
  });

  it("does not double-hash an existing fragment", () => {
    expect(videoFrameSrc("/x.mp4#t=1")).toBe("/x.mp4#t=1");
  });

  it("does not put a media fragment on blob URLs", () => {
    expect(videoFrameSrc("blob:http://localhost/abc")).toBe("blob:http://localhost/abc");
  });

  it("keeps preview time inside short clips", () => {
    expect(previewTime(10)).toBe(0.15);
    expect(previewTime(0.2)).toBe(0.05);
    expect(previewTime(0)).toBe(0.15);
  });
});
