import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { StudioCaptionsBox } from "@/components/studio/StudioCaptionsBox";
import { captionNeedSourcesCopy, captionPromptLabelForSource } from "@/lib/prepareCopy";

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

describe("StudioCaptionsBox thumbs", () => {
  it("renders a still poster per source, not a blank video", async () => {
    const { container } = render(
      <StudioCaptionsBox
        generateCaptions
        onGenerateCaptionsChange={() => {}}
        sources={[
          { key: "a", name: "xyz123.mp4", file: new File(["a"], "xyz123.mp4", { type: "video/mp4" }) },
          { key: "b", name: "abc999.mp4", file: new File(["b"], "abc999.mp4", { type: "video/mp4" }) },
        ]}
        prompts={["", ""]}
        onPromptChange={() => {}}
      />,
    );
    expect(await screen.findAllByRole("img", { name: /thumbnail$/ })).toHaveLength(2);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(screen.getByText("xyz123.mp4")).toBeInTheDocument();
    expect(container.querySelector(".studio-caption-sources")).toBeTruthy();
  });

  it("uses a switch labeled write captions, without the long hint", () => {
    render(
      <StudioCaptionsBox
        generateCaptions={false}
        onGenerateCaptionsChange={() => {}}
        sources={[]}
        prompts={[]}
        onPromptChange={() => {}}
      />,
    );
    const toggle = screen.getByTestId("studio-caption-toggle");
    expect(toggle.querySelector(".studio-switch")).toBeTruthy();
    expect(toggle.textContent).toMatch(/write captions for these copies/i);
    expect(toggle.textContent).not.toMatch(/one box per source/i);
    expect(toggle.textContent).not.toMatch(/thumbnail/i);
    expect(screen.queryByRole("heading", { name: "Captions" })).not.toBeInTheDocument();
  });
});

describe("StudioCaptionsBox per source", () => {
  it("shows one prompt per source when the toggle is on", () => {
    const onChange = vi.fn();
    render(
      <StudioCaptionsBox
        generateCaptions
        onGenerateCaptionsChange={() => {}}
        sources={[
          { key: "a", name: "aaaa.mp4", file: new File(["a"], "aaaa.mp4", { type: "video/mp4" }) },
          { key: "b", name: "bbbb.mp4", file: new File(["b"], "bbbb.mp4", { type: "video/mp4" }) },
        ]}
        prompts={["POV boil", ""]}
        onPromptChange={onChange}
      />,
    );
    expect(screen.getAllByTestId("studio-caption-source")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: captionPromptLabelForSource(1, 2) }), {
      target: { value: "Gym pull #fyp" },
    });
    expect(onChange).toHaveBeenCalledWith(1, "Gym pull #fyp");
  });

  it("asks for videos when there are no sources yet", () => {
    render(
      <StudioCaptionsBox
        generateCaptions
        onGenerateCaptionsChange={() => {}}
        sources={[]}
        prompts={[]}
        onPromptChange={() => {}}
      />,
    );
    expect(screen.getByText(captionNeedSourcesCopy())).toBeInTheDocument();
  });

  it("renders a Drive pick without a local file or thumb URL", () => {
    const { container } = render(
      <StudioCaptionsBox
        generateCaptions
        onGenerateCaptionsChange={() => {}}
        sources={[{ key: "drive-file1", name: "gym.mp4" }]}
        prompts={[""]}
        onPromptChange={() => {}}
      />,
    );
    expect(screen.getAllByText("gym.mp4").length).toBeGreaterThan(0);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByLabelText("gym.mp4 thumbnail")).toBeInTheDocument();
  });
});
