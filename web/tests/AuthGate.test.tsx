import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthMe } from "@/lib/types";

const nav = {
  pathname: "/",
  replace: vi.fn(),
};

const me: { data: AuthMe | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/components/nav/TopNav", () => ({
  TopNav: () => <div>TopNav</div>,
}));

vi.mock("@/components/nav/SideNav", () => ({
  SideNav: () => <div>SideNav</div>,
}));

vi.mock("@/components/nav/LabBanner", () => ({
  LabBanner: () => null,
}));

import { AuthGate } from "@/components/auth/AuthGate";

const AUTH_OFF: AuthMe = {
  auth_required: false,
  email: null,
  name: null,
  workspace_id: null,
  workspace_name: null,
  home_workspace_id: null,
  viewing_other: false,
  role: null,
  is_admin: false,
  has_password: false,
};

const NEED_LOGIN: AuthMe = {
  ...AUTH_OFF,
  auth_required: true,
};

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
  nav.pathname = "/";
  nav.replace.mockReset();
  me.data = undefined;
  me.isLoading = true;
});

describe("AuthGate", () => {
  it("uses the light boot screen while auth is loading", () => {
    const { container } = render(
      <AuthGate>
        <div>Studio</div>
      </AuthGate>,
    );
    expect(container.querySelector(".vf-boot")).toBeInTheDocument();
    expect(screen.queryByText("Studio")).not.toBeInTheDocument();
  });

  it("keeps the studio visible when login is off", () => {
    me.isLoading = false;
    me.data = AUTH_OFF;
    const { container } = render(
      <AuthGate>
        <div>Studio</div>
      </AuthGate>,
    );
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.getByText("TopNav")).toBeInTheDocument();
    expect(screen.getByText("SideNav")).toBeInTheDocument();
    expect(container.querySelector(".app-main")).toContainElement(screen.getByText("Studio"));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("redirects to /login when auth is required and there is no email", async () => {
    me.isLoading = false;
    me.data = NEED_LOGIN;
    render(
      <AuthGate>
        <div>Studio</div>
      </AuthGate>,
    );
    expect(screen.queryByText("Studio")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/login");
    });
  });

  it("does not redirect on /login and hides TopNav", () => {
    nav.pathname = "/login";
    me.isLoading = false;
    me.data = NEED_LOGIN;
    const { container } = render(
      <AuthGate>
        <div>Login</div>
      </AuthGate>,
    );
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.queryByText("TopNav")).not.toBeInTheDocument();
    expect(screen.queryByText("SideNav")).not.toBeInTheDocument();
    expect(container.querySelector(".app-main")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("shows the studio when logged in", () => {
    me.isLoading = false;
    me.data = LOGGED_IN;
    render(
      <AuthGate>
        <div>Studio</div>
      </AuthGate>,
    );
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.getByText("TopNav")).toBeInTheDocument();
    expect(screen.getByText("SideNav")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("sends a logged-in user away from /login", async () => {
    nav.pathname = "/login";
    me.isLoading = false;
    me.data = LOGGED_IN;
    render(
      <AuthGate>
        <div>Login</div>
      </AuthGate>,
    );
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/");
    });
  });
});
