import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceProgressCard } from "@/components/studio/SourceProgressCard";
import type { SourceProgress } from "@/lib/progress";

const okQuality = {
  vmaf: 96,
  histogram_ok: true,
  regen_count: 0,
  passed: true,
  spatial_vmaf: null,
  spatial_ok: null,
};

const base: SourceProgress = {
  source_id: "s1",
  filename: "clip.mp4",
  requested: 4,
  delivered: 0,
  done: 0,
  variants: [],
  inFlights: {},
};

describe("SourceProgressCard in-flight slot", () => {
  it("keeps a 9:16 dashed slot while the variant aspect is unknown", () => {
    render(
      <SourceProgressCard
        source={{
          ...base,
          inFlight: { index: 1, state: "rendering", attempt: 0, max_attempts: 3 },
          inFlights: { 1: { index: 1, state: "rendering", attempt: 0, max_attempts: 3 } },
        }}
      />,
    );
    const slot = screen.getByTestId("slot-1");
    expect(slot.style.aspectRatio).toBe("9 / 16");
    expect(slot.querySelector(".vf-live-shimmer")).toBeTruthy();
  });

  it("shows every requested copy as queued before the first encode", () => {
    render(<SourceProgressCard source={{ ...base, requested: 8 }} />);
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByTestId(`slot-${i}`).getAttribute("data-slot-state")).toBe("waiting");
    }
    expect(screen.getAllByText("queued")).toHaveLength(8);
    expect(screen.getByTestId("slot-1").querySelector(".vf-live-shimmer")).toBeNull();
  });

  it("labels waiting slots as starting while the job is preparing", () => {
    render(<SourceProgressCard source={{ ...base, requested: 8 }} preparing />);
    expect(screen.getAllByText("starting")).toHaveLength(8);
    expect(screen.queryByText("queued")).toBeNull();
  });

  it("labels waiting slots as waking while the Fast worker is cold-starting", () => {
    render(<SourceProgressCard source={{ ...base, requested: 8 }} waking />);
    expect(screen.getAllByText("waking")).toHaveLength(8);
    expect(screen.queryByText("queued")).toBeNull();
  });

  it("keeps every live copy on its own tile instead of hopping one slot", () => {
    render(
      <SourceProgressCard
        source={{
          ...base,
          requested: 8,
          inFlights: {
            1: { index: 1, state: "rendering", attempt: 0, max_attempts: 3 },
            2: { index: 2, state: "rendering", attempt: 0, max_attempts: 3 },
          },
        }}
      />,
    );
    expect(screen.getByTestId("slot-1").getAttribute("data-slot-state")).toBe("rendering");
    expect(screen.getByTestId("slot-2").getAttribute("data-slot-state")).toBe("rendering");
    expect(screen.getByTestId("slot-3").getAttribute("data-slot-state")).toBe("waiting");
    expect(screen.getByTestId("slot-8").getAttribute("data-slot-state")).toBe("waiting");
    expect(screen.getByText("2 rendering")).toBeTruthy();
    expect(screen.getByTestId("slot-1").querySelector(".vf-live-shimmer")).toBeTruthy();
    expect(screen.getByTestId("slot-8").querySelector(".vf-live-shimmer")).toBeNull();
  });

  it("mixes finished thumbs with live and queued slots", () => {
    render(
      <SourceProgressCard
        source={{
          ...base,
          delivered: 1,
          done: 1,
          variants: [{
            index: 1,
            filename: "v01.mp4",
            status: "ok",
            quality: okQuality,
            file_url: "/api/variants/s1/v01.mp4",
          }],
          inFlights: { 2: { index: 2, state: "rendering", attempt: 0, max_attempts: 3 } },
        }}
      />,
    );
    expect(screen.queryByTestId("slot-1")).toBeNull();
    expect(screen.getByTestId("slot-2").getAttribute("data-slot-state")).toBe("rendering");
    expect(screen.getByTestId("slot-3").getAttribute("data-slot-state")).toBe("waiting");
    expect(screen.getByTestId("slot-4").getAttribute("data-slot-state")).toBe("waiting");
  });

  it("shows source vs variant stills on looking", () => {
    render(
      <SourceProgressCard
        source={{
          ...base,
          inFlight: { index: 1, state: "looking", attempt: 0, max_attempts: 3 },
          inFlights: { 1: { index: 1, state: "looking", attempt: 0, max_attempts: 3 } },
          lookPreview: {
            index: 1,
            src: "/api/look/s1/look_v01_src.jpg",
            var: "/api/look/s1/look_v01.jpg",
            status: "ok",
            mae: 12,
          },
        }}
      />,
    );
    expect(screen.getByText(/v01 looking/)).toBeTruthy();
    expect(screen.queryByTestId("look-preview")).toBeNull();
    expect(screen.queryByAltText("Source")).toBeNull();
    expect(screen.queryByAltText("Variant")).toBeNull();
    expect(screen.getByText("look")).toBeTruthy();
  });

  it("labels a uniqueness miss as couldn't unique", () => {
    render(
      <SourceProgressCard
        source={{
          ...base,
          requested: 1,
          done: 1,
          variants: [{
            index: 1,
            filename: "v01.mp4",
            status: "uniqueness_fail",
            quality: {
              vmaf: 96,
              histogram_ok: true,
              regen_count: 0,
              passed: true,
              spatial_vmaf: null,
              spatial_ok: null,
            },
            file_url: "/api/variants/s1/v01.mp4",
            uniqueness: 18 / 64,
            uniqueness_status: "below_floor",
          }],
        }}
      />,
    );
    expect(screen.getByText("couldn't unique")).toBeTruthy();
    expect(screen.getByText("28%")).toBeTruthy();
  });
});
