import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PackLiveStrip } from "@/components/gallery/PackLiveStrip";
import { GALLERY_LIVE_STRIP_PREVIEW_HINT } from "@/lib/instagram";
import type { SourceOut, VariantOut } from "@/lib/types";

const quality = {
  vmaf: 95,
  histogram_ok: true,
  regen_count: 0,
  passed: true,
  spatial_vmaf: null,
  spatial_ok: true,
};

function variant(over: Partial<VariantOut> = {}): VariantOut {
  return {
    index: 1,
    filename: "v01.mp4",
    status: "ok",
    quality,
    file_url: "/api/variants/s1/v01.mp4",
    file_ready: true,
    ...over,
  };
}

function source(over: Partial<SourceOut> = {}): SourceOut {
  return {
    source_id: "s1",
    filename: "clip.mp4",
    requested: 2,
    delivered: 2,
    shortfall: 0,
    files_ready: 2,
    job_state: "done",
    copy_status: "ok",
    variants: [variant(), variant({ index: 2, filename: "v02.mp4" })],
    ...over,
  };
}

describe("PackLiveStrip", () => {
  it("shows a sample Insights layout when nothing is linked", () => {
    render(<PackLiveStrip source={source()} />);
    const strip = screen.getByRole("region", { name: /pack insights/i });
    expect(strip).toHaveAttribute("data-preview", "true");
    expect(screen.getByText(/sample insights/i)).toBeInTheDocument();
    expect(screen.getByText("25k")).toBeInTheDocument();
    expect(screen.getByText("views")).toBeInTheDocument();
    expect(screen.getByText(GALLERY_LIVE_STRIP_PREVIEW_HINT)).toBeInTheDocument();
  });

  it("uses live totals when Reels are linked", () => {
    render(
      <PackLiveStrip
        source={source({
          insights_views: 1234,
          insights_likes: 40,
          insights_linked: 1,
        })}
      />,
    );
    expect(screen.getByText("Live Insights")).toBeInTheDocument();
    expect(screen.getByText("1.2k")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.queryByText(/sample insights/i)).not.toBeInTheDocument();
  });
});
