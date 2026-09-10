import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthMe } from "@/lib/types";

const replace = vi.fn();
const me: { data: AuthMe | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/components/drops/DropsBoard", () => ({
  DropsBoard: () => <div>Drops board</div>,
}));

import DropsPage from "@/app/drops/page";

const AGENCY: AuthMe = {
  auth_required: true,
  email: "ops@example.com",
  name: "Ops",
  workspace_id: "ws_ops",
  workspace_name: "Ops studio",
  home_workspace_id: "ws_ops",
  viewing_other: false,
  role: "member",
  is_admin: false,
  has_password: true,
  experience: "agency",
};

beforeEach(() => {
  replace.mockReset();
  me.data = AGENCY;
  me.isLoading = false;
});

describe("Drops page", () => {
  it("shows the board for agency members", () => {
    render(<DropsPage />);
    expect(screen.getByText("Drops board")).toBeInTheDocument();
  });

  it("sends solo creators home", async () => {
    me.data = { ...AGENCY, experience: "solo", role: "owner" };
    render(<DropsPage />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/studio");
    });
    expect(screen.queryByText("Drops board")).not.toBeInTheDocument();
  });
});
