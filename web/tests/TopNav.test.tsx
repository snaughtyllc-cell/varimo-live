import { fireEvent, render, screen } from "@testing-library/react";
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
  setAdminView: vi.fn(),
}));

vi.mock("@/components/nav/StatusStrip", () => ({
  StatusStrip: () => <span>status</span>,
}));

import { TopNav } from "@/components/nav/TopNav";

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

// TopNav now only owns the mobile top bar / "More" flyout / bottom tab bar
// (desktop breakpoint gets the SideNav rail instead — see SideNav.test.tsx,
// which carries the role-gating assertions that used to live here against
// the old `.vf-desktop-nav` row).
describe("TopNav", () => {
  it("hides Drops and Workflows for solo members on the phone tab bar", () => {
    me.data = { ...BASE, experience: "solo", role: "member", is_admin: false };
    render(<TopNav />);
    expect(screen.queryByRole("link", { name: "Drops" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workflows" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Flows" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Studio" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Gallery" })[0]).toHaveAttribute("href", "/gallery");
    expect(screen.queryByRole("link", { name: "Stats" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Drive" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getAllByRole("link", { name: "Drive" })[0]).toHaveAttribute(
      "href",
      "/settings/drive",
    );
  });

  it("puts Analytics on the phone bar for owners and Drive in More", () => {
    me.data = { ...BASE, experience: "solo", role: "owner", is_admin: false };
    render(<TopNav />);
    expect(screen.queryByRole("link", { name: "Drops" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Studio" })[0]).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Analytics" })[0]).toHaveAttribute("href", "/analytics");
    expect(screen.queryByRole("link", { name: "Drive" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getAllByRole("link", { name: "Drive" })[0]).toHaveAttribute(
      "href",
      "/settings/drive",
    );
  });

  it("keeps agency phone bar at Studio, Gallery, Analytics, Flows with Drive and Drops in More", () => {
    render(<TopNav />);
    const bar = document.querySelector(".vf-mobile-tabs") as HTMLElement;
    expect([...bar.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/gallery",
      "/analytics",
      "/workflows",
    ]);
    expect(screen.queryByRole("link", { name: "Drive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Drops" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getAllByRole("link", { name: "Drive" })[0]).toHaveAttribute(
      "href",
      "/settings/drive",
    );
    expect(screen.getAllByRole("link", { name: "Drops" })[0]).toHaveAttribute("href", "/drops");
    expect(screen.getAllByRole("link", { name: "Team" })[0]).toHaveAttribute("href", "/team");
  });

  it("centers the varimo wordmark and keeps More as an icon-only control", () => {
    render(<TopNav />);
    expect(screen.getByRole("link", { name: /varimo studio home/i })).toBeInTheDocument();
    expect(document.querySelector(".vf-brand-wordmark")).toBeTruthy();
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-label", "More");
    expect(more.textContent?.trim()).toBe("");
    expect(document.querySelector(".vf-topbar-left")).toBeTruthy();
  });
});
