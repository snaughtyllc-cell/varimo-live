import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VariantOut } from "@/lib/types";
import {
  captionEmptyCopy,
  captionPreviewLabel,
  captionSaveLabel,
  captionStatusHint,
} from "@/lib/prepareCopy";

const setVariantCaption = vi.fn();

vi.mock("@/lib/api", () => ({
  setVariantCaption: (...args: unknown[]) => setVariantCaption(...args),
}));

import { CaptionBlock } from "@/components/variant/CaptionBlock";

function variant(over: Partial<VariantOut> = {}): VariantOut {
  return {
    index: 1,
    filename: "v01.mp4",
    status: "ok",
    quality: {
      vmaf: 95,
      histogram_ok: true,
      regen_count: 0,
      passed: true,
      spatial_vmaf: null,
      spatial_ok: null,
    },
    file_url: "/api/variants/s1/v01.mp4",
    caption: "POV the boil hits different\n#reels",
    ...over,
  };
}

describe("CaptionBlock", () => {
  beforeEach(() => {
    setVariantCaption.mockReset();
    setVariantCaption.mockResolvedValue(variant({ caption: "Wait — better hook\n#reels" }));
  });

  it("lets the operator edit the caption before a drop", () => {
    render(<CaptionBlock sourceId="s1" variant={variant()} onSaved={() => {}} />);
    expect(screen.getByText(captionPreviewLabel())).toBeInTheDocument();
    expect(screen.getByText(captionStatusHint())).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: captionPreviewLabel() });
    expect(box).toHaveValue("POV the boil hits different\n#reels");
    expect(screen.getByRole("button", { name: captionSaveLabel() })).toBeInTheDocument();
  });

  it("saves an edited caption on this variant", async () => {
    const onSaved = vi.fn();
    render(<CaptionBlock sourceId="s1" variant={variant()} onSaved={onSaved} />);
    const box = screen.getByRole("textbox", { name: captionPreviewLabel() });
    fireEvent.change(box, { target: { value: "Wait — better hook\n#reels" } });
    fireEvent.click(screen.getByRole("button", { name: captionSaveLabel() }));
    await waitFor(() => {
      expect(setVariantCaption).toHaveBeenCalledWith("s1", 1, "Wait — better hook\n#reels");
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("hides Copy N of M lines already stored on a copy", () => {
    render(
      <CaptionBlock
        sourceId="s1"
        variant={variant({ caption: "POV the boil hits different\n\nCopy 1 of 20\n#reels" })}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: captionPreviewLabel() })).toHaveValue(
      "POV the boil hits different\n\n#reels",
    );
  });

  it("shows empty copy as the placeholder when this copy has no caption yet", () => {
    render(
      <CaptionBlock sourceId="s1" variant={variant({ caption: null })} onSaved={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: captionPreviewLabel() })).toHaveAttribute(
      "placeholder",
      captionEmptyCopy(),
    );
  });
});
