import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  passwordLogin: vi.fn(),
}));

import { passwordLogin } from "@/lib/api";
import { LoginForm } from "@/components/auth/LoginForm";

describe("LoginForm", () => {
  beforeEach(() => {
    vi.mocked(passwordLogin).mockReset();
    vi.mocked(passwordLogin).mockResolvedValue({
      auth_required: true,
      email: "va@x.com",
      name: "va",
      workspace_id: "ws_1",
      workspace_name: "Studio",
      home_workspace_id: "ws_1",
      viewing_other: false,
      role: "member",
      is_admin: false,
      has_password: true,
    });
  });

  it("offers email/password and Google", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      "/api/auth/google/start",
    );
    expect(screen.getByText(/checkout or an invite/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agency pricing" })).toHaveAttribute("href", "/pricing");
  });

  it("posts email and password then goes home", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "va@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "va-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(passwordLogin).toHaveBeenCalledWith("va@x.com", "va-secret");
    });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/");
    });
    vi.unstubAllGlobals();
  });

  it("shows a Google oauth error from the URL", () => {
    render(<LoginForm oauthError="not_invited" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/isn't on the platform yet/i);
  });

  it("prefills email and explains first sign-in after payment", () => {
    render(<LoginForm paid emailPrefill="buyer@x.com" />);
    expect(screen.getByLabelText("Email")).toHaveValue("buyer@x.com");
    expect(screen.getByText(/Payment received/i)).toBeInTheDocument();
  });
});
