import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initRun, type RunProgress } from "@/lib/progress";

const queue = {
  data: { running: 0, fast: 0, hq: 0, jobs: [] as never[] },
  mutate: vi.fn(),
  isLoading: false,
};

const run: {
  jobId: string | null;
  complete: boolean;
  progress: RunProgress;
  prepMode?: "none" | "hq";
  upload: null | {
    phase: string;
    fileIndex: number;
    fileCount: number;
    filename: string;
    loaded: number;
    total: number;
  };
  waitStartedAt: number | null;
} = {
  jobId: null,
  complete: false,
  progress: initRun([]),
  prepMode: "none",
  upload: null,
  waitStartedAt: null,
};

vi.mock("@/lib/useQueue", () => ({
  useQueue: () => queue,
}));

vi.mock("@/lib/runStore", () => ({
  useRun: () => run,
}));

vi.mock("@/lib/api", () => ({
  cancelJob: vi.fn(),
  sourceUrl: (id: string) => `/api/sources/${id}/source`,
}));

import { StudioLiveQueue } from "@/components/studio/StudioLiveQueue";

const quality = {
  vmaf: 96,
  histogram_ok: true,
  regen_count: 0,
  passed: true,
  spatial_vmaf: null,
  spatial_ok: null,
};

describe("StudioLiveQueue reserved tracks", () => {
  beforeEach(() => {
    run.jobId = null;
    run.complete = false;
    run.progress = initRun([]);
    run.prepMode = "none";
    run.upload = null;
    run.waitStartedAt = null;
    queue.data = { running: 0, fast: 0, hq: 0, jobs: [] };
  });

  it("keeps the rows track mounted when the queue is empty so Generate cannot grow the rail", () => {
    const { container } = render(<StudioLiveQueue />);
    expect(container.querySelector(".studio-live__rows")).toBeTruthy();
    expect(container.querySelector(".studio-live__finished")).toBeTruthy();
    expect(screen.getByText(/Queue is clear/i)).toBeInTheDocument();
  });

  it("shows live copy tiles with a finished thumb and a render overlay", () => {
    run.jobId = "j1";
    run.progress = {
      complete: false,
      bySource: {
        s1: {
          source_id: "s1",
          filename: "clip.mp4",
          requested: 3,
          delivered: 1,
          done: 1,
          inFlights: { 2: { index: 2, state: "rendering", attempt: 0, max_attempts: 3 } },
          variants: [
            {
              index: 1,
              filename: "v01.mp4",
              status: "ok",
              quality,
              file_url: "/api/variants/s1/v01.mp4",
              look_var_url: "/api/look/s1/look_v01.jpg",
              uniqueness: 0.55,
            },
          ],
        },
      },
    };

    render(<StudioLiveQueue />);
    expect(screen.getByText("LIVE COPIES")).toBeInTheDocument();
    expect(document.querySelector('[data-tile="done"]')).toBeTruthy();
    expect(document.querySelector('[data-tile="live"]')).toBeTruthy();
    expect(document.querySelector('[data-tile="waiting"]')).toBeTruthy();
    expect(document.querySelector('[data-tile="done"] [data-poster]')).toBeTruthy();
    expect(document.querySelector('[data-tile="done"] video')).toBeNull();
    expect(document.querySelector('[data-tile="live"] video')).toBeNull();
    expect(document.querySelector('[data-has-thumb="true"]')).toBeTruthy();
    expect(screen.getByText("rendering")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
  });

  it("names reconstruct-first on the live rail while Fast tiles have not started", () => {
    run.jobId = "j1";
    run.prepMode = "hq";
    run.progress = initRun([{ source_id: "s1", filename: "clip.mp4", requested: 8 }]);
    render(<StudioLiveQueue />);
    expect(screen.getByTestId("hq-reconstruct-copy")).toHaveTextContent(/reconstruct/i);
    expect(screen.getByTestId("hq-reconstruct-copy")).toHaveTextContent(/Fast/i);
  });

  it("shows Cancel on a queued pack, not only after it is running", () => {
    queue.data = {
      running: 1,
      fast: 1,
      hq: 0,
      jobs: [
        {
          job_id: "aaa",
          quality_mode: "fast",
          state: "queued",
          created_utc: "2026-08-20T02:00:00Z",
          count: 8,
          source_count: 1,
          filenames: ["clip.mp4"],
          delivered: 0,
          requested: 8,
          position: 1,
        },
      ],
    };
    render(<StudioLiveQueue />);
    expect(screen.getByRole("button", { name: /cancel pack/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel pack/i })).toHaveTextContent("Cancel");
  });

  it("lets you cancel this browser's pack before the shared queue lists it", () => {
    run.jobId = "j-local";
    run.progress = initRun([{ source_id: "s1", filename: "clip.mp4", requested: 3 }]);
    render(<StudioLiveQueue />);
    expect(screen.getByRole("button", { name: /cancel pack/i })).toBeInTheDocument();
  });

  it("shows upload percent instead of a frozen starting label", () => {
    run.jobId = "preparing";
    run.waitStartedAt = Date.now();
    run.progress = initRun([{ source_id: "prep-0", filename: "C2033.mp4", requested: 2 }]);
    run.upload = {
      phase: "direct",
      fileIndex: 0,
      fileCount: 1,
      filename: "C2033.mp4",
      loaded: 50 * 1024 * 1024,
      total: 100 * 1024 * 1024,
    };
    render(<StudioLiveQueue />);
    expect(screen.getByTestId("live-queue-wait").textContent).toMatch(/Uploading 1 of 1/);
    expect(screen.getByTestId("live-queue-wait").textContent).toMatch(/50%/);
    expect(screen.getAllByText("uploading")).toHaveLength(2);
  });

  it("names a Fast cold start with a moving elapsed clock", () => {
    run.jobId = "j1";
    run.waitStartedAt = Date.now() - 8000;
    run.progress = {
      ...initRun([{ source_id: "s1", filename: "clip.mp4", requested: 2 }]),
      waitPhase: "queued",
    };
    render(<StudioLiveQueue />);
    expect(screen.getByTestId("live-queue-wait").textContent).toMatch(/8s elapsed/);
    expect(screen.getByTestId("live-queue-wait").textContent).toMatch(/cold-start queue/i);
    expect(screen.getAllByText("waking")).toHaveLength(2);
  });
});
