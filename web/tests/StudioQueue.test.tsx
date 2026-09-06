import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudioQueueCard } from "@/components/studio/StudioQueue";
import type { QueueSnapshot } from "@/lib/types";

const two: QueueSnapshot = {
  running: 2,
  fast: 1,
  hq: 1,
  jobs: [
    {
      job_id: "aaa",
      quality_mode: "fast",
      state: "running",
      created_utc: "2026-08-20T02:00:00Z",
      count: 8,
      source_count: 1,
      filenames: ["IMG_0683_proxy.mp4"],
      delivered: 3,
      requested: 8,
      position: 1,
    },
    {
      job_id: "bbb",
      quality_mode: "hq",
      state: "running",
      created_utc: "2026-08-20T02:01:00Z",
      count: 5,
      source_count: 1,
      filenames: ["partner.mov"],
      delivered: 0,
      requested: 5,
      position: 2,
    },
  ],
};

describe("StudioQueueCard", () => {
  it("lists live packs by filename and Fast/HQ, not the video", () => {
    render(<StudioQueueCard queue={two} qualityMode="fast" jobId={null} />);
    expect(screen.getByText("2 packs generating")).toBeInTheDocument();
    expect(screen.getByText("1. Fast · IMG_0683.mp4 · 3/8")).toBeInTheDocument();
    expect(screen.getByText("2. HQ · partner.mov · 0/5")).toBeInTheDocument();
    expect(screen.getByText(/waits in line/i)).toBeInTheDocument();
  });

  it("marks your pack when this browser started it", () => {
    render(<StudioQueueCard queue={two} qualityMode="hq" jobId="bbb" />);
    expect(screen.getByText(/2\. HQ · partner\.mov · 0\/5 · you/)).toBeInTheDocument();
  });

  it("cancels a live pack from the queue row", () => {
    const onCancel = vi.fn();
    render(
      <StudioQueueCard queue={two} qualityMode="fast" jobId={null} onCancel={onCancel} />,
    );
    const buttons = screen.getAllByRole("button", { name: /^cancel$/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onCancel).toHaveBeenCalledWith("aaa");
  });
});
