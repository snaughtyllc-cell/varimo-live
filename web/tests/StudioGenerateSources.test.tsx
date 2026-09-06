import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthMe } from "@/lib/types";

const createJob = vi.fn();
const createJobFromDrive = vi.fn();
const start = vi.fn();
const beginPrepare = vi.fn();
const clear = vi.fn();

vi.mock("@/lib/api", () => ({
  getHealth: async () => ({ status: "ok", lab: false }),
  createJob: (...args: unknown[]) => createJob(...args),
  createJobFromDrive: (...args: unknown[]) => createJobFromDrive(...args),
}));

vi.mock("@/lib/runStore", () => ({
  useRun: () => ({
    start,
    beginPrepare,
    clear,
    jobId: null,
    complete: false,
  }),
}));

const me: { data: AuthMe | undefined } = { data: undefined };

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/components/studio/StudioLiveQueue", () => ({
  StudioLiveQueue: () => <div data-testid="live-queue" />,
}));

import StudioPage from "@/app/page";

const SOLO: AuthMe = {
  auth_required: true,
  email: "jeff@example.com",
  name: "Jeff",
  workspace_id: "ws_lab",
  workspace_name: "Lab",
  home_workspace_id: "ws_lab",
  viewing_other: false,
  role: "owner",
  is_admin: true,
  has_password: false,
  experience: "solo",
};

beforeAll(() => {
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:file-thumb");
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  me.data = SOLO;
  createJob.mockReset();
  createJobFromDrive.mockReset();
  start.mockReset();
  beginPrepare.mockReset();
  clear.mockReset();
  createJob.mockResolvedValue({ job_id: "j1", sources: [] });
});

describe("Studio source draft after Generate", () => {
  it("clears the clip from Source once Generate starts so a new pack can be added", async () => {
    const { container } = render(<StudioPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], "gym-pull.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("gym-pull.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => {
      expect(createJob).toHaveBeenCalled();
    });
    expect(screen.queryByText("gym-pull.mp4")).not.toBeInTheDocument();
    expect(screen.getByText(/no clips yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload files/i })).not.toBeDisabled();
  });
});
