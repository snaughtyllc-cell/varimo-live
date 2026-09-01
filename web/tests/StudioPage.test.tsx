import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthMe } from "@/lib/types";
import { initRun } from "@/lib/progress";
import { captionNeedSourcesCopy, captionPromptLabelForSource } from "@/lib/prepareCopy";

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

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:studio-thumb");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
});

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
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Caption bank")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/new folder/i)).not.toBeInTheDocument();
  });

  it("asks for videos before showing caption boxes", () => {
    render(<StudioPage />);
    fireEvent.click(screen.getByRole("checkbox", { name: /write captions for these copies/i }));
    expect(screen.getByText(captionNeedSourcesCopy())).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens one caption box per dropped source, with a thumbnail", () => {
    render(<StudioPage />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const a = new File(["aaa"], "aaaa1111.mp4", { type: "video/mp4" });
    const b = new File(["bbb"], "bbbb2222.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [a, b] } });

    fireEvent.click(screen.getByRole("checkbox", { name: /write captions for these copies/i }));
    expect(screen.getAllByTestId("studio-caption-source")).toHaveLength(2);
    const first = screen.getByRole("textbox", { name: captionPromptLabelForSource(0, 2) });
    const second = screen.getByRole("textbox", { name: captionPromptLabelForSource(1, 2) });
    fireEvent.change(first, { target: { value: "POV boil #reels" } });
    fireEvent.change(second, { target: { value: "Gym pull #fyp" } });
    expect(first).toHaveValue("POV boil #reels");
    expect(second).toHaveValue("Gym pull #fyp");
    expect(document.querySelectorAll(".studio-source-thumb").length).toBeGreaterThanOrEqual(2);
  });
});
