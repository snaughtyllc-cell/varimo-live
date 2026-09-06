import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { initRun } from "@/lib/progress";

const sources = [{ source_id: "prep-0", filename: "clip.mp4", requested: 8 }];

vi.mock("@/lib/runStore", () => ({
  useRun: () => ({
    jobId: "preparing",
    progress: initRun(sources),
    complete: false,
    clear: vi.fn(),
    qualityMode: "fast",
  }),
}));

import { ProgressPanel } from "@/components/studio/ProgressPanel";

describe("ProgressPanel preparing", () => {
  it("shows preparing copy and hides Cancel until a real job exists", () => {
    render(<ProgressPanel />);
    expect(screen.getByText("Preparing generation")).toBeInTheDocument();
    expect(screen.getByText(/1–2 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/elapsed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New run" })).toBeInTheDocument();
  });
});
