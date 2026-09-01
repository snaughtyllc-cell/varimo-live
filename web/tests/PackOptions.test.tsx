import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SourceOut, VariantOut } from "@/lib/types";
import { packOptionsLabel, rewriteCaptionsLabel, rewriteCaptionsSeedLabel } from "@/lib/prepareCopy";

const rewriteSourceCaptions = vi.fn();

vi.mock("@/lib/api", () => ({
  rewriteSourceCaptions: (...args: unknown[]) => rewriteSourceCaptions(...args),
}));

import { PackOptions } from "@/components/gallery/PackOptions";

function source(over: Partial<SourceOut> = {}): SourceOut {
  const variant: VariantOut = {
    index: 1,
    filename: "v01.mp4",
    status: "ok",
    quality: {
      vmaf: 95,
      histogram_ok: true,
      regen_count: 0,
      passed: true,
      spatial_vmaf: null,
      spatial_ok: true,
    },
    file_url: "/api/variants/s1/v01.mp4",
    caption: "POV boil #reels",
  };
  return {
    source_id: "s1",
    filename: "clip.mp4",
    requested: 2,
    delivered: 2,
    shortfall: 0,
    files_ready: 2,
    job_state: "done",
    copy_status: "ok",
    caption_prompt: "POV boil #reels",
    variants: [variant],
    ...over,
  };
}

describe("PackOptions", () => {
  beforeEach(() => {
    rewriteSourceCaptions.mockReset();
    rewriteSourceCaptions.mockResolvedValue(source());
  });

  it("rewrites every copy from the seed without crowding the pack header", async () => {
    const onRewritten = vi.fn();
    render(<PackOptions source={source()} onRewritten={onRewritten} />);
    fireEvent.click(screen.getByRole("button", { name: packOptionsLabel() }));
    const box = screen.getByRole("textbox", { name: rewriteCaptionsSeedLabel() });
    fireEvent.change(box, { target: { value: "Gym pump #fyp" } });
    fireEvent.click(screen.getByRole("button", { name: rewriteCaptionsLabel() }));
    await waitFor(() => {
      expect(rewriteSourceCaptions).toHaveBeenCalledWith("s1", "Gym pump #fyp");
    });
    await waitFor(() => {
      expect(onRewritten).toHaveBeenCalled();
    });
  });
});
