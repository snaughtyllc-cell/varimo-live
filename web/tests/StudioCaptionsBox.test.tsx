import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FileList } from "@/components/studio/FileList";
import { StudioCaptionsBox } from "@/components/studio/StudioCaptionsBox";
import { captionNeedSourcesCopy, captionPromptLabelForSource } from "@/lib/prepareCopy";

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:file-thumb");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
});

describe("FileList thumbs", () => {
  it("renders a video thumb per dropped file, not a color tile", () => {
    const files = [
      new File(["a"], "xyz123.mp4", { type: "video/mp4" }),
      new File(["b"], "abc999.mp4", { type: "video/mp4" }),
    ];
    const { container } = render(
      <FileList files={files} durations={[12, 8]} onRemove={() => {}} />,
    );
    expect(container.querySelectorAll("video")).toHaveLength(2);
    expect(screen.getByText("xyz123.mp4")).toBeInTheDocument();
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
});
