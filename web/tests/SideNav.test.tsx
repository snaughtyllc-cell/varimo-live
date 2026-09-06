import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthMe } from "@/lib/types";

const me: { data: AuthMe | undefined } = { data: undefined };

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => me,
}));

vi.mock("@/lib/api", () => ({
  logout: vi.fn(),
}));

import { SideNav } from "@/components/nav/SideNav";
import { EXTRA_TABS, PRIMARY_TABS } from "@/lib/studioDestinations";

const BASE: AuthMe = {
  auth_required: true,
  email: "ops@example.com",
  name: "Ops",
  workspace_id: "ws_ops",
  workspace_name: "Ops",
  home_workspace_id: "ws_ops",
  viewing_other: false,
  role: "owner",
  is_admin: false,
  has_password: true,
  experience: "agency",
};

beforeEach(() => {
  me.data = BASE;
});

// Desktop rail — this is where TopNav's old `.vf-desktop-nav` role-gating
// assertions moved to once the horizontal top-nav became the SideNav.
describe("SideNav", () => {
  it("shows Team for workspace owners", () => {
    render(<SideNav />);
    expect(screen.getAllByRole("link", { name: "Team" })[0]).toHaveAttribute("href", "/team");
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("hides Team for members", () => {
    me.data = { ...BASE, role: "member" };
    render(<SideNav />);
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
  });

  it("shows Team and Admin for the site admin", () => {
    me.data = { ...BASE, email: "jeff@example.com", is_admin: true };
    render(<SideNav />);
    expect(screen.getAllByRole("link", { name: "Team" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Admin" })[0]).toHaveAttribute("href", "/admin");
  });

  it("hides Diagnostics for operators", () => {
    render(<SideNav />);
    expect(screen.queryByRole("link", { name: "Diagnostics" })).not.toBeInTheDocument();
  });

  it("shows Diagnostics for the site admin", () => {
    me.data = { ...BASE, email: "jeff@example.com", is_admin: true };
    render(<SideNav />);
    expect(screen.getAllByRole("link", { name: "Diagnostics" })[0]).toHaveAttribute(
      "href",
      "/diagnostics",
    );
  });

  it("keeps Diagnostics when login is off", () => {
    me.data = {
      ...BASE,
      auth_required: false,
      email: null,
      role: null,
      is_admin: false,
    };
    render(<SideNav />);
    expect(screen.getAllByRole("link", { name: "Diagnostics" }).length).toBeGreaterThan(0);
  });

  it("exposes primary destinations including Drops", () => {
    render(<SideNav />);
    for (const tab of PRIMARY_TABS) {
      expect(screen.getAllByRole("link", { name: tab.label })[0]).toHaveAttribute(
        "href",
        tab.href,
      );
    }
  });

  it("hides Drops and Workflows for solo members", () => {
    me.data = { ...BASE, experience: "solo", role: "member", is_admin: false };
    render(<SideNav />);
    expect(screen.queryByRole("link", { name: "Drops" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workflows" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Studio" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Gallery" })[0]).toHaveAttribute("href", "/gallery");
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Drive" })[0]).toHaveAttribute(
      "href",
      "/settings/drive",
    );
  });

  it("keeps Analytics as an extra for solo owners, not a primary tab", () => {
    me.data = { ...BASE, experience: "solo", role: "owner", is_admin: false };
    render(<SideNav />);
    expect(screen.queryByRole("link", { name: "Drops" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Studio" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Drive" })[0]).toHaveAttribute(
      "href",
      "/settings/drive",
    );
    expect(screen.getAllByRole("link", { name: "Analytics" })[0]).toHaveAttribute(
      "href",
      "/analytics",
    );
  });

  it("renders role extras from the same catalog as the IA doc", () => {
    me.data = { ...BASE, email: "jeff@example.com", is_admin: true };
    render(<SideNav />);
    for (const tab of EXTRA_TABS) {
      expect(screen.getAllByRole("link", { name: tab.label })[0]).toHaveAttribute(
        "href",
        tab.href,
      );
    }
  });

  it("shows the account email and a working log out button", () => {
    render(<SideNav />);
    expect(screen.getByTitle("ops@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });
});
