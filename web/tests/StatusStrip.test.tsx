import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueueSnapshot } from "@/lib/types";

const health: { data?: { status: string }; error?: Error } = { data: { status: "ok" } };
const queue: { data: QueueSnapshot } = {
  data: { running: 0, fast: 0, hq: 0, jobs: [] },
};

vi.mock("swr", () => ({
  default: () => health,
}));

vi.mock("@/lib/useQueue", () => ({
  useQueue: () => queue,
}));

import { StatusStrip } from "@/components/nav/StatusStrip";

describe("StatusStrip", () => {
  it("keeps Ready copy in a class the mobile bar can hide", () => {
    health.data = { status: "ok" };
    health.error = undefined;
    queue.data = { running: 0, fast: 0, hq: 0, jobs: [] };
    const { container } = render(<StatusStrip />);
    expect(container.querySelector(".status-ready-text")).toHaveTextContent("Ready");
    expect(container.querySelector(".status-engine")).toBeTruthy();
    expect(container.querySelector(".status-engine__dot")).toBeTruthy();
    expect(container.querySelector(".status-queue")).toBeNull();
  });

  it("marks the loading ellipsis the same way so phones only show the dot", () => {
    health.data = undefined;
    health.error = undefined;
    const { container } = render(<StatusStrip />);
    expect(container.querySelector(".status-ready-text")).toHaveTextContent("…");
  });

  it("puts the live queue pill in its own class so the mobile bar can drop it", () => {
    health.data = { status: "ok" };
    health.error = undefined;
    queue.data = {
      running: 1,
      fast: 1,
      hq: 0,
      jobs: [
        {
          job_id: "aaa",
          quality_mode: "fast",
          state: "running",
          created_utc: "2026-08-20T02:00:00Z",
          count: 8,
          source_count: 1,
          filenames: ["clip.mp4"],
          delivered: 3,
          requested: 8,
          position: 1,
        },
      ],
    };
    render(<StatusStrip />);
    expect(screen.getByText("1 gen · Fast 3/8")).toHaveClass("status-queue");
  });
});
