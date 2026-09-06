import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DestinationsPanel } from "@/components/drive/DestinationsPanel";
import type { AuthMe, DriveStatus } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDriveStatus: vi.fn(),
  listDestinations: vi.fn(),
  createDestination: vi.fn(),
  deleteDestination: vi.fn(),
  disconnectDriveOAuth: vi.fn(),
  testDestination: vi.fn(),
  updateDestination: vi.fn(),
}));

const me: { data: AuthMe | undefined } = { data: undefined };

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

import { getDriveStatus, listDestinations } from "@/lib/api";

const MEMBER: AuthMe = {
  auth_required: true,
  email: "partner@example.com",
  name: "Partner",
  workspace_id: "ws_1",
  workspace_name: "Studio",
  home_workspace_id: "ws_1",
  viewing_other: false,
  role: "owner",
  is_admin: false,
  has_password: true,
  experience: "agency",
};

const ADMIN: AuthMe = { ...MEMBER, email: "jeff@example.com", is_admin: true };

const ready: DriveStatus = {
  status: "ready",
  sa_email: "bot@x.iam.gserviceaccount.com",
  message: "Drive ready",
  auth_mode: "oauth",
  connected_email: "snaughtyllc@gmail.com",
  oauth_available: true,
  share_email: "drive@varyforge.app",
};

const notConfigured: DriveStatus = {
  status: "not_configured",
  sa_email: null,
  message: "Drive not connected — Connect Google in Settings",
  auth_mode: null,
  connected_email: null,
  oauth_available: true,
  share_email: "drive@varyforge.app",
};

describe("DestinationsPanel share email", () => {
  beforeEach(() => {
    me.data = MEMBER;
    vi.mocked(getDriveStatus).mockResolvedValue(ready);
    vi.mocked(listDestinations).mockResolvedValue([]);
  });

  it("shows a copyable branded mailbox at the top of Drive", async () => {
    render(<DestinationsPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("drive-share-email").textContent).toBe("drive@varyforge.app");
    });
    expect(screen.getByText(/Share this email/i)).toBeTruthy();
    expect(screen.getByText(/paste the folder link below/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByText(/Reconnect Google as/)).toBeNull();
  });

  it("hides Connect Google from operators — they only share the studio mailbox", async () => {
    vi.mocked(getDriveStatus).mockResolvedValue(notConfigured);
    render(<DestinationsPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("drive-share-email").textContent).toBe("drive@varyforge.app");
    });
    expect(screen.queryByRole("link", { name: "Connect Google" })).not.toBeInTheDocument();
    expect(screen.queryByText("Google account")).not.toBeInTheDocument();
    expect(screen.getAllByText(/only the site admin connects/i).length).toBeGreaterThan(0);
  });

  it("lets the site admin Connect Google when Drive is not connected", async () => {
    me.data = ADMIN;
    vi.mocked(getDriveStatus).mockResolvedValue(notConfigured);
    render(<DestinationsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute(
        "href",
        "/api/drive/oauth/start",
      );
    });
    expect(screen.getByText("Google account")).toBeTruthy();
  });

  it("hides Disconnect from operators on a connected workspace", async () => {
    render(<DestinationsPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("drive-share-email").textContent).toBe("drive@varyforge.app");
    });
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Google account")).not.toBeInTheDocument();
  });
});
