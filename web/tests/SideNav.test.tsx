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

  it("hides the remaining bar when usage is missing or Pay as you go", () => {
    const { rerender } = render(<SideNav />);
    expect(screen.queryByRole("progressbar", { name: "Monthly packs remaining" })).toBeNull();
    me.data = {
      ...BASE,
      plan: "payg",
      usage: {
        uncapped: false,
        used_variants: 0,
        included_packs: 0,
        included_variants: 0,
        meter_line: "Pay as you go · 0 packs this month · extra $5.00",
        remaining_pct: 0,
      },
    };
    rerender(<SideNav />);
    expect(screen.queryByRole("progressbar", { name: "Monthly packs remaining" })).toBeNull();
  });

  it("shows a full Internal bar above email and logout", () => {
    me.data = {
      ...BASE,
      email: "jeff@example.com",
      is_admin: true,
      plan: "internal",
      usage: {
        uncapped: true,
        used_variants: 24,
        included_packs: 0,
        included_variants: 0,
        meter_line: null,
        remaining_pct: 100,
      },
    };
    render(<SideNav />);
    const bar = screen.getByRole("progressbar", { name: "Monthly packs remaining" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("uncapped")).toBeInTheDocument();
    expect(bar.compareDocumentPosition(screen.getByTitle("jeff@example.com"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows remaining packs from 100 to 0 above email and logout", () => {
    me.data = {
      ...BASE,
      experience: "solo",
      plan: "creator",
      usage: {
        uncapped: false,
        used_variants: 0,
        included_packs: 12,
        included_variants: 96,
        meter_line: "Creator · 0 of 12 packs this month",
        remaining_pct: 100,
      },
    };
    const { rerender } = render(<SideNav />);
    const bar = screen.getByRole("progressbar", { name: "Monthly packs remaining" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("12 of 12 left")).toBeInTheDocument();
    expect(bar.compareDocumentPosition(screen.getByTitle("ops@example.com"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    me.data = {
      ...me.data,
      usage: {
        ...me.data.usage!,
        used_variants: 96,
        remaining_pct: 0,
        meter_line: "Creator · 12 of 12 packs this month",
      },
    };
    rerender(<SideNav />);
    expect(screen.getByRole("progressbar", { name: "Monthly packs remaining" }).getAttribute("aria-valuenow")).toBe(
      "0",
    );
    expect(screen.getByText("0 of 12 left")).toBeInTheDocument();
  });

  it("drains Agency Fast hours and flips to Usage after the included block", () => {
    me.data = {
      ...BASE,
      plan: "agency",
      usage: {
        uncapped: false,
        hard_stop: false,
        tone: "included",
        used_variants: 0,
        included_fast_hours: 90,
        remaining_pct: 50,
        meter_line: "45 of 90h left",
      },
    };
    const { rerender } = render(<SideNav />);
    const bar = screen.getByRole("progressbar", { name: "Fast hours remaining" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("data-tone", "included");
    expect(screen.getByText("45 of 90h left")).toBeInTheDocument();
    me.data = {
      ...me.data,
      usage: {
        ...me.data.usage!,
        tone: "usage",
        remaining_pct: 0,
        meter_line: "Usage",
      },
    };
    rerender(<SideNav />);
    expect(screen.getByRole("progressbar", { name: "Fast hour usage" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(screen.getByText("Usage")).toBeInTheDocument();
  });
});
