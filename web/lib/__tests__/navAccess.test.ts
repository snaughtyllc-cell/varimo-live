import { describe, it, expect } from "vitest";
import { showAnalyticsNav, showDiagnosticsNav, showTeamNav, visiblePrimaryTabs } from "@/lib/navAccess";
import { PRIMARY_TABS } from "@/lib/studioDestinations";

describe("showDiagnosticsNav", () => {
  it("hides for logged-in operators", () => {
    expect(showDiagnosticsNav({ auth_required: true, is_admin: false })).toBe(false);
  });

  it("shows for site admin", () => {
    expect(showDiagnosticsNav({ auth_required: true, is_admin: true })).toBe(true);
  });

  it("shows when login is off", () => {
    expect(showDiagnosticsNav({ auth_required: false, is_admin: false })).toBe(true);
  });
});

describe("showTeamNav", () => {
  it("shows for agency owners and site admin", () => {
    expect(showTeamNav({ role: "owner", is_admin: false, experience: "agency" })).toBe(true);
    expect(showTeamNav({ role: "member", is_admin: true, experience: "solo" })).toBe(true);
  });

  it("hides for members", () => {
    expect(showTeamNav({ role: "member", is_admin: false, experience: "agency" })).toBe(false);
  });

  it("hides Team for solo creators even when they own the workspace", () => {
    expect(
      showTeamNav({
        role: "owner",
        is_admin: false,
        experience: "solo",
        auth_required: true,
      }),
    ).toBe(false);
  });
});

describe("showAnalyticsNav", () => {
  it("shows for workspace owners including solo", () => {
    expect(
      showAnalyticsNav({ role: "owner", is_admin: false, auth_required: true }),
    ).toBe(true);
  });

  it("hides for VAs", () => {
    expect(
      showAnalyticsNav({ role: "member", is_admin: false, auth_required: true }),
    ).toBe(false);
  });

  it("shows for site admin and when login is off", () => {
    expect(
      showAnalyticsNav({ role: "member", is_admin: true, auth_required: true }),
    ).toBe(true);
    expect(
      showAnalyticsNav({ role: null, is_admin: false, auth_required: false }),
    ).toBe(true);
  });
});

describe("visiblePrimaryTabs", () => {
  it("keeps all five operator tabs for agency, admin, and auth off", () => {
    const labels = PRIMARY_TABS.map((d) => d.label);
    expect(
      visiblePrimaryTabs({
        experience: "agency",
        is_admin: false,
        auth_required: true,
      }).map((d) => d.label),
    ).toEqual(labels);
    expect(
      visiblePrimaryTabs({
        experience: "solo",
        is_admin: true,
        auth_required: true,
      }).map((d) => d.label),
    ).toEqual(labels);
    expect(
      visiblePrimaryTabs({
        experience: "solo",
        is_admin: false,
        auth_required: false,
      }).map((d) => d.label),
    ).toEqual(labels);
  });

  it("hides Drops and Workflows for solo members", () => {
    expect(
      visiblePrimaryTabs({
        experience: "solo",
        is_admin: false,
        auth_required: true,
      }).map((d) => d.href),
    ).toEqual(["/", "/gallery", "/settings/drive"]);
  });
});
