import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getDriveStatus = vi.fn();
const listDestinations = vi.fn();

vi.mock("@/lib/api", () => ({
  getDriveStatus: () => getDriveStatus(),
  listDestinations: () => listDestinations(),
}));

import { StudioOutputFolder } from "@/components/studio/StudioOutputFolder";

beforeEach(() => {
  getDriveStatus.mockReset();
  listDestinations.mockReset();
});

describe("StudioOutputFolder", () => {
  it("lists connected Drive folders and reports the pick", async () => {
    const onChange = vi.fn();
    getDriveStatus.mockResolvedValue({ status: "ready", sa_email: null, message: "ok" });
    listDestinations.mockResolvedValue([
      { id: "dst_out", name: "Reels out", folder_id: "f1", auth_mode: "oauth" },
    ]);
    render(<StudioOutputFolder value="" onChange={onChange} />);
    const select = await screen.findByRole("combobox", { name: "Output folder" });
    expect(screen.getByText("Output folder")).toBeInTheDocument();
    expect(screen.getByText(/when Generate finishes/i)).toBeInTheDocument();
    expect(screen.queryByText(/output size/i)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Don't send" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "dst_out" } });
    expect(onChange).toHaveBeenCalledWith("dst_out");
  });

  it("points to Drive settings when no folders are saved", async () => {
    getDriveStatus.mockResolvedValue({ status: "ready", sa_email: null, message: "ok" });
    listDestinations.mockResolvedValue([]);
    render(<StudioOutputFolder value="" onChange={vi.fn()} />);
    expect(await screen.findByRole("link", { name: "Add a Drive folder" })).toHaveAttribute(
      "href",
      "/settings/drive",
    );
    expect(screen.queryByRole("combobox", { name: "Output folder" })).not.toBeInTheDocument();
  });

  it("clears a folder that is no longer saved", async () => {
    const onChange = vi.fn();
    getDriveStatus.mockResolvedValue({ status: "ready", sa_email: null, message: "ok" });
    listDestinations.mockResolvedValue([
      { id: "dst_out", name: "Reels out", folder_id: "f1", auth_mode: "oauth" },
    ]);
    render(<StudioOutputFolder value="dst_gone" onChange={onChange} />);
    await screen.findByRole("combobox", { name: "Output folder" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("disables the picker until Drive is ready", async () => {
    getDriveStatus.mockResolvedValue({
      status: "not_configured",
      sa_email: null,
      message: "share studio@",
    });
    listDestinations.mockResolvedValue([
      { id: "dst_out", name: "Reels out", folder_id: "f1", auth_mode: "oauth" },
    ]);
    render(<StudioOutputFolder value="" onChange={vi.fn()} />);
    expect(await screen.findByRole("combobox", { name: "Output folder" })).toBeDisabled();
    expect(screen.getByText(/Drive isn't ready/i)).toBeInTheDocument();
  });
});
