import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Destination, DriveStatus, Workflow } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDriveStatus: vi.fn(),
  listDestinations: vi.fn(),
  listWorkflows: vi.fn(),
  listCaptionBanks: vi.fn(),
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  cancelWorkflow: vi.fn(),
}));

import {
  cancelWorkflow,
  createWorkflow,
  getDriveStatus,
  listCaptionBanks,
  listDestinations,
  listWorkflows,
  updateWorkflow,
} from "@/lib/api";
import { WorkflowsPanel } from "@/components/workflows/WorkflowsPanel";

const status: DriveStatus = {
  status: "ready",
  sa_email: "bot@x.com",
  message: "Drive connected",
};

const destinations: Destination[] = [
  { id: "dst_in", name: "Inbox", folder_id: "IN", auth_mode: "oauth" },
  { id: "dst_out", name: "Out", folder_id: "OUT", auth_mode: "oauth" },
];

const live: Workflow = {
  id: "wf_1",
  name: "Strata Test",
  inbox_destination_id: "dst_in",
  output_destination_id: "dst_out",
  count: 8,
  quality_mode: "fast",
  allow_creative_escalate: true,
  enabled: true,
  poll_seconds: 240,
  last_sweep_at: "2026-08-20T14:00:00Z",
  last_summary: {
    queued: 1,
    exported: 0,
    skipped: 0,
    failed: 0,
    running: 1,
    job_ids: ["job_live"],
  },
  auto_caption: false,
  caption_bank_id: null,
};

beforeEach(() => {
  vi.mocked(getDriveStatus).mockResolvedValue(status);
  vi.mocked(listDestinations).mockResolvedValue(destinations);
  vi.mocked(listWorkflows).mockResolvedValue([live]);
  vi.mocked(listCaptionBanks).mockResolvedValue([]);
  vi.mocked(cancelWorkflow).mockResolvedValue({ ...live, enabled: false, last_summary: { ...live.last_summary!, running: 0 } });
});

describe("WorkflowsPanel captions", () => {
  it("creates a workflow with Drive filenames as the caption seed", async () => {
    vi.mocked(listWorkflows).mockResolvedValue([]);
    vi.mocked(createWorkflow).mockResolvedValue({
      ...live,
      id: "wf_new",
      name: "Mixed inbox",
      caption_from_filename: true,
      auto_caption: false,
    });
    render(<WorkflowsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create workflow/i })).not.toBeDisabled();
    });
    const name = screen.getByPlaceholderText(/reels inbox/i);
    fireEvent.change(name, { target: { value: "Mixed inbox" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /use drive filenames as captions/i }));
    fireEvent.click(screen.getByRole("button", { name: /create workflow/i }));
    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        name: "Mixed inbox",
        caption_from_filename: true,
        auto_caption: false,
      }));
    });
  });

  it("hides the caption folder while Drive filenames are on", async () => {
    vi.mocked(listWorkflows).mockResolvedValue([]);
    vi.mocked(listCaptionBanks).mockResolvedValue([
      {
        id: "bank_generic",
        name: "Generic",
        count: 4,
        remaining: 4,
        cursor: 0,
        low: true,
        is_default: true,
      },
    ]);
    render(<WorkflowsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create workflow/i })).not.toBeDisabled();
    });
    expect(screen.getByText(/^caption folder$/i)).toBeInTheDocument();
    expect(screen.getByText(/auto-caption from bank/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /use drive filenames as captions/i }));
    expect(screen.queryByText(/^caption folder$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-caption from bank/i)).not.toBeInTheDocument();
  });

  it("turns Filenames on for an existing workflow and turns the bank off", async () => {
    vi.mocked(updateWorkflow).mockResolvedValue({
      ...live,
      caption_from_filename: true,
      auto_caption: false,
    });
    render(<WorkflowsPanel />);
    const box = await screen.findByRole("checkbox", { name: /^filenames$/i });
    fireEvent.click(box);
    await waitFor(() => {
      expect(updateWorkflow).toHaveBeenCalledWith("wf_1", {
        caption_from_filename: true,
        auto_caption: false,
      });
    });
  });
});

describe("WorkflowsPanel cancel", () => {
  it("cancels a live sweep: Watch off + stop the pack", async () => {
    render(<WorkflowsPanel />);
    const cancel = await screen.findByRole("button", { name: /^cancel$/i });
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(cancelWorkflow).toHaveBeenCalledWith("wf_1");
    });
  });

  it("offers Use Drive filenames as captions", async () => {
    render(<WorkflowsPanel />);
    expect(await screen.findByRole("checkbox", { name: /use drive filenames as captions/i })).toBeInTheDocument();
  });
});
