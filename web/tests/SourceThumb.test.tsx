import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SourceThumb } from "@/components/studio/SourceThumb";

vi.mock("@/lib/videoPoster", () => ({
  captureVideoPoster: vi.fn(async () => "data:image/jpeg;base64,poster"),
}));

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:file-thumb");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
});

describe("SourceThumb", () => {
  it("shows a still poster for a local upload, not a blank video", async () => {
    const file = new File(["x"], "gym.mp4", { type: "video/mp4" });
    render(<SourceThumb file={file} label="gym.mp4" />);
    const img = await screen.findByRole("img", { name: "gym.mp4 thumbnail" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "data:image/jpeg;base64,poster");
    expect(document.querySelector("video")).toBeNull();
  });
});
