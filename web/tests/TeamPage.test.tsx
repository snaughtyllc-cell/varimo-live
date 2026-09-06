import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthMe, Team } from "@/lib/types";

const push = vi.fn();
const replace = vi.fn();

const me: { data: AuthMe | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/lib/api", () => ({
  getWorkspaceTeam: vi.fn(),
  createWorkspaceInvite: vi.fn(),
  deleteWorkspaceInvite: vi.fn(),
  removeWorkspaceMember: vi.fn(),
}));

import {
  createWorkspaceInvite,
  deleteWorkspaceInvite,
  getWorkspaceTeam,
  removeWorkspaceMember,
} from "@/lib/api";
import TeamPage from "@/app/team/page";

const OWNER: AuthMe = {
  auth_required: true,
  email: "ops@example.com",
  name: "Ops",
  workspace_id: "ws_ops",
  workspace_name: "Ops studio",
  home_workspace_id: "ws_ops",
  viewing_other: false,
  role: "owner",
  is_admin: false,
  has_password: true,
};

const team: Team = {
  workspace_id: "ws_ops",
  workspace_name: "Ops studio",
  members: [
    { email: "ops@example.com", name: "Ops", role: "owner", week_fast: 4, week_hq: 1, week_packs: 1 },
    { email: "va@example.com", name: "VA", role: "member", week_fast: 0, week_hq: 0, week_packs: 0 },
  ],
  invites: [
    {
      id: "inv_1",
      email: "helper@example.com",
      kind: "join",
      workspace_id: "ws_ops",
      created_utc: "2026-08-20T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  me.data = OWNER;
  me.isLoading = false;
  vi.mocked(getWorkspaceTeam).mockResolvedValue(team);
  vi.mocked(createWorkspaceInvite).mockResolvedValue({
    id: "inv_2",
    email: "new@example.com",
    kind: "join",
    workspace_id: "ws_ops",
    created_utc: "2026-08-20T01:00:00Z",
  });
  vi.mocked(deleteWorkspaceInvite).mockResolvedValue(undefined);
  vi.mocked(removeWorkspaceMember).mockResolvedValue(undefined);
});

describe("Team page", () => {
  it("lists members and pending join invites for the owner", async () => {
    render(<TeamPage />);
    expect(await screen.findByText("va@example.com")).toBeInTheDocument();
    expect(screen.getByText("This week: 4 Fast · 1 HQ · 1 pack")).toBeInTheDocument();
    expect(screen.getByText("This week: no packs")).toBeInTheDocument();
    expect(screen.getByText("helper@example.com")).toBeInTheDocument();
    expect(screen.getByText(/join this workspace/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite kind")).not.toBeInTheDocument();
  });

  it("invites a VA into this workspace", async () => {
    render(<TeamPage />);
    await screen.findByText("va@example.com");
    fireEvent.change(screen.getByLabelText("Invite email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^invite$/i }));
    await waitFor(() => {
      expect(createWorkspaceInvite).toHaveBeenCalledWith("new@example.com");
    });
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
  });

  it("Remove revokes a VA login", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(getWorkspaceTeam)
      .mockResolvedValueOnce(team)
      .mockResolvedValueOnce({
        ...team,
        members: [{ email: "ops@example.com", name: "Ops", role: "owner" }],
      });
    render(<TeamPage />);
    expect(await screen.findByText("va@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove va@example.com" }));
    await waitFor(() => {
      expect(removeWorkspaceMember).toHaveBeenCalledWith("va@example.com");
    });
    await waitFor(() => {
      expect(screen.queryByText("va@example.com")).not.toBeInTheDocument();
    });
  });

  it("deletes a pending invite", async () => {
    render(<TeamPage />);
    expect(await screen.findByText("helper@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(deleteWorkspaceInvite).toHaveBeenCalledWith("inv_1");
    });
    await waitFor(() => {
      expect(screen.queryByText("helper@example.com")).not.toBeInTheDocument();
    });
  });

  it("sends members home", async () => {
    me.data = { ...OWNER, role: "member", is_admin: false };
    render(<TeamPage />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  it("warns when the site admin is viewing another studio", async () => {
    me.data = {
      ...OWNER,
      email: "jeff@example.com",
      is_admin: true,
      viewing_other: true,
      workspace_id: "ws_other",
      home_workspace_id: "ws_ops",
    };
    render(<TeamPage />);
    expect(await screen.findByText(/home studio/i)).toBeInTheDocument();
  });
});
