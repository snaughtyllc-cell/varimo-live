import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FileList } from "@/components/studio/FileList";

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

describe("FileList thumbs", () => {
  it("shows a still poster for each local source", async () => {
    const file = new File(["x"], "gym.mp4", { type: "video/mp4" });
    render(<FileList files={[file]} durations={[12]} onRemove={() => {}} />);
    expect(screen.getByText("gym.mp4")).toBeInTheDocument();
    const img = await screen.findByRole("img", { name: "gym.mp4 thumbnail" });
    expect(img.tagName).toBe("IMG");
    expect(document.querySelector(".studio-clip-card video")).toBeNull();
  });
});
