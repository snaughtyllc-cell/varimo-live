import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalyticsBoard } from "../analytics/AnalyticsBoard";

const mockGetInstagramStatus = vi.fn();
const mockGetInstagramAnalytics = vi.fn();
const mockSyncInstagram = vi.fn();
const mockRegenerate = vi.fn();
const mockGetGallery = vi.fn();
const mockLinkInstagramMedia = vi.fn();

vi.mock("@/lib/api", () => ({
  getInstagramStatus: () => mockGetInstagramStatus(),
  getInstagramAnalytics: () => mockGetInstagramAnalytics(),
  syncInstagram: () => mockSyncInstagram(),
  regenerate: (id: string, n: number) => mockRegenerate(id, n),
  getGallery: () => mockGetGallery(),
  linkInstagramMedia: (body: unknown) => mockLinkInstagramMedia(body),
  disconnectInstagram: vi.fn(),
  pasteInstagramToken: vi.fn(),
}));

vi.mock("@/lib/useAuthMe", () => ({
  useAuthMe: () => ({ data: { auth_required: false, email: "ops@example.com" } }),
}));

const accounts = [{ user_id: "1", username: "jeff", name: "Jeff" }];

const analytics = {
  insights_views: 312400,
  insights_linked: 14,
  ranked: [
    {
      source_id: "winner",
      filename: "winner.mp4",
      insights_views: 300000,
      insights_linked: 12,
      insights_unknown: 8,
    },
    {
      source_id: "quiet",
      filename: "quiet.mp4",
      insights_views: 12400,
      insights_linked: 2,
      insights_unknown: 0,
    },
  ],
  suggestions: [
    {
      kind: "winner",
      source_id: "winner",
      filename: "winner.mp4",
      copy: "This original is carrying the week. Generate 20 more of this original.",
    },
    {
      kind: "quiet",
      source_id: "quiet",
      filename: "quiet.mp4",
      copy: "These copies are not getting push. Try a new original — this may be the video, not the variant.",
    },
  ],
  accounts,
};

describe("AnalyticsBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstagramStatus.mockResolvedValue({
      oauth_available: true,
      connected: true,
      message: "",
      accounts,
    });
    mockGetInstagramAnalytics.mockResolvedValue(analytics);
    mockGetGallery.mockResolvedValue([]);
  });

  it("shows pack totals and ranked originals on the Analytics tab", async () => {
    render(<AnalyticsBoard />);
    expect(await screen.findByText(/312k views across 14 linked posts/i)).toBeTruthy();
    expect(screen.getByText(/Winner · winner.mp4/)).toBeTruthy();
    expect(screen.getByText("quiet.mp4")).toBeTruthy();
    expect(screen.getByText(/not getting push/i)).toBeTruthy();
    expect(screen.getByText(/not getting push/i).textContent).not.toMatch(/flagged/i);
    expect(screen.getByRole("button", { name: /generate 20 more of this original/i })).toBeTruthy();
  });

  it("does not mint more from first-ranked unless G4 calls it a winner", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      suggestions: [],
    });
    render(<AnalyticsBoard />);
    expect(await screen.findByText("winner.mp4")).toBeTruthy();
    expect(screen.queryByText(/Winner ·/)).toBeNull();
    expect(screen.queryByRole("button", { name: /generate 20 more of this original/i })).toBeNull();
  });

  it("mints more of the winning original", async () => {
    mockRegenerate.mockResolvedValue({});
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /generate 20 more of this original/i }));
    expect(mockRegenerate).toHaveBeenCalledWith("winner", 20);
  });

  it("keeps unmatched Reels off the ranked scoreboard until that tab is opened", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      unmatched: [
        {
          media_id: "orphan",
          permalink: "https://www.instagram.com/reel/OrphanReel/",
          caption: "reused bank line",
          username: "lab.ig",
          ig_user_id: "178",
        },
      ],
    });
    mockGetGallery.mockResolvedValue([
      {
        source_id: "winner",
        filename: "winner.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{ index: 3, filename: "v03.mp4", ig_media_id: null }],
      },
    ]);

    render(<AnalyticsBoard />);
    expect(await screen.findByText(/Winner · winner.mp4/)).toBeTruthy();
    expect(screen.queryByText(/reused bank line/i)).toBeNull();
    expect(screen.getByRole("tab", { name: /unmatched reels \(1\)/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /unmatched reels \(1\)/i }));
    expect(await screen.findByText(/before varimo/i)).toBeTruthy();
    expect(screen.queryByText(/reused bank line/i)).toBeNull();
    expect(screen.getByLabelText(/pick a gallery pack/i)).toBeTruthy();
  });

  it("links an unmatched Reel after they pick the Gallery pack first", async () => {
    mockSyncInstagram.mockResolvedValue({
      matched: 1,
      accounts: 1,
      media: 2,
      unmatched: [
        {
          media_id: "orphan",
          permalink: "https://www.instagram.com/reel/OrphanReel/",
          caption: "reused bank line",
          username: "lab.ig",
          ig_user_id: "178",
        },
      ],
      analytics: {
        ...analytics,
        unmatched: [
          {
            media_id: "orphan",
            permalink: "https://www.instagram.com/reel/OrphanReel/",
            caption: "reused bank line",
            username: "lab.ig",
            ig_user_id: "178",
          },
        ],
      },
    });
    mockGetGallery.mockResolvedValue([
      {
        source_id: "winner",
        filename: "winner.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{ index: 3, filename: "v03.mp4", ig_media_id: null }],
      },
    ]);
    mockLinkInstagramMedia.mockResolvedValue({ ...analytics, unmatched: [] });

    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /sync insights/i }));
    expect(await screen.findByText(/Winner · winner.mp4/)).toBeTruthy();
    expect(screen.queryByText(/reused bank line/i)).toBeNull();

    fireEvent.click(await screen.findByRole("tab", { name: /unmatched reels \(1\)/i }));
    fireEvent.change(screen.getByLabelText(/pick a gallery pack/i), {
      target: { value: "winner" },
    });
    expect(await screen.findByText(/reused bank line/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open reel/i })).toHaveAttribute(
      "href",
      "https://www.instagram.com/reel/OrphanReel/",
    );

    fireEvent.change(screen.getByLabelText(/pick the copy you posted/i), {
      target: { value: "winner:3" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /reused bank line/i }));
    fireEvent.click(screen.getByRole("button", { name: /^link reel$/i }));

    await waitFor(() => {
      expect(mockLinkInstagramMedia).toHaveBeenCalledWith({
        source_id: "winner",
        index: 3,
        media_id: "orphan",
        ig_user_id: "178",
        permalink: "https://www.instagram.com/reel/OrphanReel/",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/reused bank line/i)).toBeNull();
    });
  });
});
