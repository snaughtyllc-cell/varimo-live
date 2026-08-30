import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthMe } from "@/lib/types";
import { initRun } from "@/lib/progress";

const me: { data: AuthMe | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/lib/useQueue", () => ({
  useQueue: () => ({
    data: { running: 0, fast: 0, hq: 0, jobs: [] },
    mutate: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/lib/runStore", () => ({
  useRun: () => ({
    start: vi.fn(),
    beginPrepare: vi.fn(),
    clear: vi.fn(),
    jobId: null,
    complete: false,
    progress: initRun([]),
    qualityMode: "fast",
  }),
}));

vi.mock("@/lib/api", () => ({
  createJob: vi.fn(),
  createJobFromDrive: vi.fn(),
  cancelJob: vi.fn(),
  listCaptionBanks: vi.fn(async () => []),
  listCaptions: vi.fn(async () => ({
    cursor: 0,
    items: [],
    captions: [],
    remaining: 0,
    count: 0,
    bank_id: "",
  })),
}));

import StudioPage from "@/app/page";

const SOLO: AuthMe = {
  auth_required: true,
  email: "jeff@example.com",
  name: "Jeff",
  workspace_id: "ws_home",
  workspace_name: "Jeff",
  home_workspace_id: "ws_home",
  viewing_other: false,
  role: "owner",
  is_admin: true,
  has_password: true,
  experience: "solo",
};

beforeEach(() => {
  me.data = SOLO;
  me.isLoading = false;
});

describe("Studio page captions", () => {
  it("shows the captions box on Studio, including the caption bank", async () => {
    render(<StudioPage />);

    const box = screen.getByTestId("studio-captions-box");
    expect(box).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Captions" })).toBeInTheDocument();
    expect(screen.getByText(/write captions for these copies/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Caption bank")).toBeInTheDocument();
    });
  });
});
