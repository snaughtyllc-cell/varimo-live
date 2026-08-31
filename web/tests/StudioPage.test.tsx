import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthMe } from "@/lib/types";
import { initRun } from "@/lib/progress";
import { captionPromptPlaceholder } from "@/lib/prepareCopy";

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
  it("shows Write captions for these copies and not the old caption bank", () => {
    render(<StudioPage />);

    expect(screen.getByTestId("studio-captions-box")).toBeInTheDocument();
    expect(screen.getByText(/write captions for these copies/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /write captions for these copies/i })).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: /caption for these copies/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Caption bank")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/new folder/i)).not.toBeInTheDocument();
  });

  it("opens a prompt box when the toggle is on", () => {
    render(<StudioPage />);

    fireEvent.click(screen.getByRole("checkbox", { name: /write captions for these copies/i }));
    const box = screen.getByRole("textbox", { name: /caption for these copies/i });
    expect(box).toBeInTheDocument();
    expect(box).toHaveAttribute("placeholder", captionPromptPlaceholder());
    fireEvent.change(box, { target: { value: "POV she said wait for it #reels" } });
    expect(box).toHaveValue("POV she said wait for it #reels");
  });
});
