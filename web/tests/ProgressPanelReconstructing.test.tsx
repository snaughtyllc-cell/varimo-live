import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { initRun } from "@/lib/progress";
import { reconstructFirstHeadline, reconstructFirstSubcopy } from "@/lib/hqWaitCopy";

const sources = [{ source_id: "s1", filename: "clip.mp4", requested: 8 }];

vi.mock("@/lib/runStore", () => ({
  useRun: () => ({
    jobId: "j1",
    progress: initRun(sources),
    complete: false,
    clear: vi.fn(),
    qualityMode: "fast",
    prepMode: "hq",
  }),
}));

import { ProgressPanel } from "@/components/studio/ProgressPanel";

describe("ProgressPanel reconstruct-first", () => {
  it("names the HQ pass while Fast tiles have not started", () => {
    render(<ProgressPanel />);
    expect(screen.getByText(reconstructFirstHeadline())).toBeInTheDocument();
    expect(screen.getByText(reconstructFirstSubcopy())).toBeInTheDocument();
    expect(screen.queryByText("Preparing generation")).not.toBeInTheDocument();
  });
});
