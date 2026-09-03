import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InstagramPanel } from "../InstagramPanel";
import { INSTAGRAM_TESTER_HINT } from "@/lib/instagram";

const mockGetInstagramStatus = vi.fn();
const mockDisconnectInstagram = vi.fn();
const mockPasteInstagramToken = vi.fn();

vi.mock("@/lib/api", () => ({
  getInstagramStatus: () => mockGetInstagramStatus(),
  disconnectInstagram: (id: string) => mockDisconnectInstagram(id),
  pasteInstagramToken: (t: string) => mockPasteInstagramToken(t),
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => ({
    data: { auth_required: false, email: "ops@example.com" },
  }),
}));

describe("InstagramPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstagramStatus.mockResolvedValue({
      accounts: [],
      connected: false,
      oauth_available: true,
      message: "",
    });
  });

  it("lists each connected handle and Connect adds another", async () => {
    mockGetInstagramStatus.mockResolvedValue({
      accounts: [
        {
          user_id: "111",
          username: "jeff",
          name: "Jeff",
          connected_utc: "2026-09-02T00:00:00Z",
        },
        {
          user_id: "222",
          username: "growth",
          name: "Growth",
          connected_utc: "2026-09-02T01:00:00Z",
        },
      ],
      connected: true,
      oauth_available: true,
      message: "2 Instagram accounts connected — Connect another tester anytime",
    });
    render(<InstagramPanel />);
    expect(await screen.findByText("@jeff")).toBeTruthy();
    expect(screen.getByText("@growth")).toBeTruthy();
    expect(screen.getByRole("link", { name: /connect another account/i })).toHaveAttribute(
      "href",
      "/api/instagram/oauth/start",
    );
    expect(screen.getByText(/instagram testers/i).textContent?.toLowerCase()).toContain(
      "instagram testers",
    );
    expect(INSTAGRAM_TESTER_HINT.toLowerCase()).toContain("tester invites");
  });

  it("disconnects one handle without claiming all are gone", async () => {
    mockGetInstagramStatus.mockResolvedValue({
      accounts: [
        {
          user_id: "111",
          username: "jeff",
          name: "Jeff",
          connected_utc: "2026-09-02T00:00:00Z",
        },
      ],
      connected: true,
      oauth_available: true,
      message: "",
    });
    mockDisconnectInstagram.mockResolvedValue({
      accounts: [],
      connected: false,
      oauth_available: true,
      message: "",
    });
    window.confirm = vi.fn(() => true);
    render(<InstagramPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect @jeff/i }));
    expect(mockDisconnectInstagram).toHaveBeenCalledWith("111");
  });

  it("keeps paste-token collapsed as fallback", async () => {
    render(<InstagramPanel />);
    await screen.findByRole("link", { name: /connect instagram/i });
    expect(screen.queryByLabelText(/long-lived token/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /paste a token instead/i }));
    expect(screen.getByLabelText(/long-lived token/i)).toBeTruthy();
  });
});
