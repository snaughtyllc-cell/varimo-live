import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthMe } from "@/lib/types";

const me: { data: AuthMe | undefined; mutate: ReturnType<typeof vi.fn> } = {
  data: undefined,
  mutate: vi.fn(),
};

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/lib/api", () => ({
  setStudioPassword: vi.fn(),
}));

import { setStudioPassword } from "@/lib/api";
import { PasswordPanel } from "@/components/auth/PasswordPanel";

const LOGGED_IN: AuthMe = {
  auth_required: true,
  email: "jeff@example.com",
  name: "Jeff",
  workspace_id: "ws_1",
  workspace_name: "Jeff",
  home_workspace_id: "ws_1",
  viewing_other: false,
  role: "owner",
  is_admin: true,
  has_password: false,
};

beforeEach(() => {
  me.data = LOGGED_IN;
  me.mutate.mockReset();
  me.mutate.mockResolvedValue(undefined);
  vi.mocked(setStudioPassword).mockReset();
  vi.mocked(setStudioPassword).mockResolvedValue(undefined);
});

describe("PasswordPanel", () => {
  it("lets a user without a password add one", async () => {
    render(<PasswordPanel />);
    expect(screen.getByRole("button", { name: "Add password" })).toBeInTheDocument();
    expect(screen.getByText(/sign in with email/i)).toBeInTheDocument();
    expect(screen.getByText(/share studio@ \/ paste folder/i)).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New studio password"), {
      target: { value: "secret12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add password" }));
    await waitFor(() => {
      expect(setStudioPassword).toHaveBeenCalledWith("secret12");
    });
    expect(await screen.findByText("Password saved.")).toBeInTheDocument();
  });

  it("lets a user replace their email sign-in password", () => {
    me.data = { ...LOGGED_IN, has_password: true };
    render(<PasswordPanel />);
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByText(/replace the password for email sign-in/i)).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  });
});
