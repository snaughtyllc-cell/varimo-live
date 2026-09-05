import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CompareSlider } from "@/components/variant/CompareSlider";

function setVideoSize(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompareSlider aspect", () => {
  it("defaults to a 9:16 box until the variant metadata loads", () => {
    const { container } = render(
      <CompareSlider beforeSrc="/src.mp4" afterSrc="/var.mp4" />,
    );
    const box = container.querySelector(".compare-slider") as HTMLElement;
    expect(box.style.aspectRatio).toBe("9 / 16");
    expect(box.style.maxHeight).toBe("46dvh");
  });

  it("sizes the box from the variant video's frame", () => {
    const { container } = render(
      <CompareSlider beforeSrc="/src.mp4" afterSrc="/wide.mp4" />,
    );
    const videos = container.querySelectorAll("video");
    const after = videos[0] as HTMLVideoElement;
    setVideoSize(after, 1920, 1080);
    fireEvent.loadedMetadata(after);
    const box = container.querySelector(".compare-slider") as HTMLElement;
    expect(box.style.aspectRatio).toBe("1920 / 1080");
    expect(box.style.maxHeight).toBe("46dvh");
  });

  it("does not take aspect from the source (before) layer", () => {
    const { container } = render(
      <CompareSlider beforeSrc="/src.mp4" afterSrc="/var.mp4" />,
    );
    const videos = container.querySelectorAll("video");
    setVideoSize(videos[1] as HTMLVideoElement, 1920, 1080);
    fireEvent.loadedMetadata(videos[1]);
    const box = container.querySelector(".compare-slider") as HTMLElement;
    expect(box.style.aspectRatio).toBe("9 / 16");
  });
});

describe("CompareSlider audio", () => {
  it("plays the variant with sound and keeps the source muted", () => {
    const { container } = render(
      <CompareSlider beforeSrc="/src.mp4" afterSrc="/var.mp4" />,
    );
    const videos = container.querySelectorAll("video");
    const after = videos[0] as HTMLVideoElement;
    const before = videos[1] as HTMLVideoElement;
    expect(after.muted).toBe(false);
    expect(before.muted).toBe(true);
  });
});
