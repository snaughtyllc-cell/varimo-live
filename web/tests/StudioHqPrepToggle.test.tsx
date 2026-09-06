import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  me.data = SOLO;
  createJob.mockReset();
  createJobFromDrive.mockReset();
  start.mockReset();
  beginPrepare.mockReset();
  clear.mockReset();
  createJob.mockResolvedValue({ job_id: "j1", sources: [] });
});

function addClip(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2])], "a.mp4", { type: "video/mp4" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("Studio HQ reconstruct toggle", () => {
  it("shows the reconstruct switch off by default", () => {
    render(<StudioPage />);
    const toggle = screen.getByTestId("hq-prep-toggle");
    const box = toggle.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(toggle.textContent).toMatch(/reconstruct first/i);
    expect(toggle.textContent).not.toMatch(/lab only/i);
  });

  it("Generate stays Fast and sends prep_mode none unless the switch is on", async () => {
    const { container } = render(<StudioPage />);
    addClip(container);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => {
      expect(createJob).toHaveBeenCalled();
    });
    const args = createJob.mock.calls[0];
    expect(args[3]).toBe("fast");
    expect(args[5]).toBe("none");
  });

  it("Generate with the switch on sends prep_mode hq and Fast quality", async () => {
    const { container } = render(<StudioPage />);
    const toggle = screen.getByTestId("hq-prep-toggle");
    fireEvent.click(toggle.querySelector("input[type='checkbox']") as HTMLInputElement);
    addClip(container);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => {
      expect(createJob).toHaveBeenCalled();
    });
    const args = createJob.mock.calls[0];
    expect(args[3]).toBe("fast");
    expect(args[5]).toBe("hq");
  });
});
