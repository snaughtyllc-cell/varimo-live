import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { VideoThumb } from "@/components/common/VideoThumb";

function setVideoSize(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VideoThumb", () => {
  it("defaults to 9 / 16 until metadata loads", () => {
    const { container } = render(<VideoThumb src="/v.mp4" />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.aspectRatio).toBe("9 / 16");
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.objectFit).toBe("contain");
  });

  it("uses the video's pixel aspect after metadata", () => {
    const { container } = render(<VideoThumb src="/wide.mp4" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    setVideoSize(video, 1920, 1080);
    fireEvent.loadedMetadata(video);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.aspectRatio).toBe("1920 / 1080");
  });

  it("keeps 9 / 16 when metadata has no frame size", () => {
    const { container } = render(<VideoThumb src="/v.mp4" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    setVideoSize(video, 0, 0);
    fireEvent.loadedData(video);
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe("9 / 16");
  });

  it("mounts the video immediately when eager is set", () => {
    const { container } = render(<VideoThumb src="/live.mp4" eager />);
    expect(container.querySelector("video")).toBeTruthy();
  });

  it("fills a parent frame without applying its own aspect when fill is set", () => {
    const { container } = render(<VideoThumb src="/v.mp4" fill />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute("data-fill")).toBe("true");
    expect(box.style.aspectRatio).toBe("");
    expect(box.style.width).toBe("100%");
    expect(box.style.height).toBe("100%");
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.objectFit).toBe("cover");
  });

  it("plays on hover and pauses on leave", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);

    const { container } = render(<VideoThumb src="/v.mp4" />);
    const box = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(box);
    expect(play).toHaveBeenCalled();
    fireEvent.mouseLeave(box);
    expect(pause).toHaveBeenCalled();
  });
});
