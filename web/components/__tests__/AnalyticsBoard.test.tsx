import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AnalyticsBoard } from "../analytics/AnalyticsBoard";

const mockGetInstagramStatus = vi.fn();
const mockGetInstagramAnalytics = vi.fn();
const mockSyncInstagram = vi.fn();
const mockRegenerate = vi.fn();
const mockGetGallery = vi.fn();
const mockLinkInstagramMedia = vi.fn();
const mockUnlinkInstagramMedia = vi.fn();

vi.mock("@/lib/api", () => ({
  getInstagramStatus: () => mockGetInstagramStatus(),
  getInstagramAnalytics: () => mockGetInstagramAnalytics(),
  syncInstagram: () => mockSyncInstagram(),
  regenerate: (id: string, n: number) => mockRegenerate(id, n),
  getGallery: () => mockGetGallery(),
  linkInstagramMedia: (body: unknown) => mockLinkInstagramMedia(body),
  unlinkInstagramMedia: (body: unknown) => mockUnlinkInstagramMedia(body),
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
  insights_fetched_at: "2099-01-01T00:00:00Z",
  ranked: [
    {
      source_id: "winner",
      filename: "winner.mp4",
      insights_views: 300000,
      insights_likes: 400,
      insights_comments: 20,
      insights_shares: 80,
      insights_saved: 15,
      insights_follows: 12,
      insights_linked: 12,
      insights_unknown: 8,
      tracked: [
        {
          index: 3,
          ig_media_id: "w3",
          ig_user_id: "1",
          username: "jeff.main",
          post_url: "https://www.instagram.com/reel/WinnerCopy/",
          insights_views: 200000,
          insights_likes: 300,
          insights_shares: 60,
          insights_follows: 10,
          insights_skip_rate: 0.2,
          insights_watch_time: 4.1,
          account_connected: true,
        },
        {
          index: 7,
          ig_media_id: "mck",
          ig_user_id: "mckenzie",
          username: "mckenzie.trial",
          insights_views: 800,
          account_connected: false,
        },
        {
          index: 19,
          ig_media_id: "growth-19",
          ig_user_id: "growth",
          username: "mckenzie.growth",
          post_url: "https://www.instagram.com/reel/GrowthCopy/",
          insights_views: 1200,
          insights_shares: 4,
          insights_reach: 900,
          account_connected: true,
        },
      ],
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
      kind: "held_no_push",
      source_id: "quiet",
      filename: "quiet.mp4",
      copy: "Hold looks fine, but these copies are not getting push versus the rest of this account. Insights cannot see policy.",
    },
  ],
  accounts,
  lanes: [
    {
      ig_user_id: "1",
      username: "jeff.main",
      insights_views: 300000,
      insights_linked: 12,
      account_connected: true,
    },
    {
      ig_user_id: "mckenzie",
      username: "mckenzie.trial",
      insights_views: 800,
      insights_linked: 1,
      account_connected: false,
    },
    {
      ig_user_id: "growth",
      username: "mckenzie.growth",
      insights_views: 1200,
      insights_linked: 1,
      account_connected: true,
    },
  ],
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
    mockSyncInstagram.mockResolvedValue({
      matched: 14,
      accounts: 1,
      media: 20,
      unmatched: [],
      analytics,
    });
  });

  it("does not hit Graph again when the last Insights pull is still fresh", async () => {
    render(<AnalyticsBoard />);
    expect(await screen.findByText(/Winner · winner.mp4/)).toBeTruthy();
    expect(mockSyncInstagram).not.toHaveBeenCalled();
  });

  it("shows since-last-look view change on ranked originals", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      insights_views_delta: 12000,
      ranked: [{
        ...analytics.ranked[0],
        insights_views_delta: 12000,
      }, analytics.ranked[1]],
    });
    render(<AnalyticsBoard />);
    const pack = await screen.findByRole("button", { name: /winner.*winner\.mp4/i });
    expect(pack.textContent).toMatch(/\+12k/);
    expect(await screen.findByText(/312k views across 14 linked posts/i)).toBeTruthy();
    expect(screen.getByText(/\+12k since last look/i)).toBeTruthy();
  });

  it("syncs Insights when Stats opens on a stale pull", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      insights_fetched_at: "2026-09-01T00:00:00Z",
    });
    mockSyncInstagram.mockResolvedValue({
      matched: 14,
      accounts: 1,
      media: 20,
      unmatched: [],
      analytics: {
        ...analytics,
        insights_views: 320000,
        insights_fetched_at: "2026-09-03T08:00:00Z",
      },
    });
    render(<AnalyticsBoard />);
    expect(await screen.findByText(/Winner · winner.mp4/)).toBeTruthy();
    await waitFor(() => {
      expect(mockSyncInstagram).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/320k views across 14 linked posts/i)).toBeTruthy();
  });

  it("does not auto-sync when no Instagram account is connected", async () => {
    mockGetInstagramStatus.mockResolvedValue({
      oauth_available: true,
      connected: false,
      message: "",
      accounts: [],
    });
    mockGetInstagramAnalytics.mockResolvedValue({
      insights_views: null,
      insights_linked: 0,
      insights_fetched_at: null,
      ranked: [],
      accounts: [],
    });
    render(<AnalyticsBoard />);
    expect(await screen.findByRole("button", { name: /sync insights/i })).toBeDisabled();
    expect(mockSyncInstagram).not.toHaveBeenCalled();
  });

  it("paints a look still on ranked originals so phones do not wait on a video frame", async () => {
    mockGetGallery.mockResolvedValue([
      {
        source_id: "winner",
        filename: "winner.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{
          index: 1,
          filename: "v01.mp4",
          file_url: "/api/variants/winner/v01.mp4",
          look_var_url: "/api/look/winner/look_v01.jpg",
          file_ready: true,
        }],
      },
    ]);
    render(<AnalyticsBoard />);
    const pack = await screen.findByRole("button", { name: /winner.*winner\.mp4/i });
    expect(pack.querySelector("img")?.getAttribute("src")).toBe("/api/look/winner/look_v01.jpg");
    expect(pack.querySelector("video")).toBeNull();
  });

  it("seeks a video frame when the pack has no look still", async () => {
    mockGetGallery.mockResolvedValue([
      {
        source_id: "winner",
        filename: "winner.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{
          index: 1,
          filename: "v01.mp4",
          file_url: "/api/variants/winner/v01.mp4",
          file_ready: true,
        }],
      },
    ]);
    render(<AnalyticsBoard />);
    const pack = await screen.findByRole("button", { name: /winner.*winner\.mp4/i });
    expect(pack.querySelector("video")?.getAttribute("src")).toBe(
      "/api/variants/winner/v01.mp4#t=0.15",
    );
  });

  it("shows pack totals and ranked originals on the Analytics tab", async () => {
    render(<AnalyticsBoard />);
    expect(await screen.findByText(/312k views across 14 linked posts/i)).toBeTruthy();
    expect(screen.getByText(/Winner · winner.mp4/)).toBeTruthy();
    expect(screen.getByText(/Held, little push · quiet.mp4/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /winner.*winner\.mp4.*300k views.*80 shares/i })).toBeTruthy();
    expect(screen.queryByText(/^copy 03$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /generate 20 more of this original/i })).toBeNull();
  });

  it("keeps the ranked index to packs and opens an Insights sheet for the original", async () => {
    render(<AnalyticsBoard />);
    const pack = await screen.findByRole("button", { name: /winner.*winner\.mp4/i });
    expect(screen.queryByText(/^copy 19$/i)).toBeNull();

    fireEvent.click(pack);

    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    expect(within(sheet).getByText(/^copy 19$/i)).toBeTruthy();
    expect(within(sheet).getAllByRole("link", { name: /open reel/i })
      .some((link) => link.getAttribute("href") === "https://www.instagram.com/reel/GrowthCopy/"))
      .toBe(true);
  });

  it("labels every account as trial reels and still names the disconnected handle", async () => {
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));

    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    expect(within(sheet).getAllByText("Trial reels").length).toBe(3);
    expect(within(sheet).queryByText("Main lane")).toBeNull();
    expect(within(sheet).queryByText("Growth lane")).toBeNull();
    expect(within(sheet).queryByText("Account lane")).toBeNull();
    expect(within(sheet).getByText("@jeff.main")).toBeTruthy();
    expect(within(sheet).getAllByText(/@mckenzie\.trial · account not connected/i).length).toBeGreaterThan(0);
  });

  it("omits Graph-unknown metrics in the sheet instead of writing them as zero", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      ranked: [{
        ...analytics.ranked[0],
        insights_likes: null,
        insights_comments: undefined,
        insights_saved: null,
        insights_reach: undefined,
        tracked: [{
          ...analytics.ranked[0]!.tracked![0]!,
          insights_likes: null,
          insights_comments: undefined,
          insights_saved: null,
          insights_reach: undefined,
          insights_skip_rate: null,
          insights_watch_time: undefined,
        }],
      }],
    });
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));

    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    expect(within(sheet).getByText(/200k views/i)).toBeTruthy();
    expect(within(sheet).queryByText(/0 (reach|likes|comments|saved)/i)).toBeNull();
    expect(within(sheet).queryByText(/% skip|s watch/i)).toBeNull();
  });

  it("keeps Insights suggestions out of policy language inside the sheet", async () => {
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /quiet\.mp4/i }));

    const sheet = await screen.findByRole("dialog", { name: /quiet\.mp4 insights/i });
    expect(within(sheet).getByText(/held, little push/i)).toBeTruthy();
    expect(within(sheet).queryByText(/flagged/i)).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /generate 20 more/i })).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));
    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /generate 20 more of this original/i }));
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
        username: "lab.ig",
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/reused bank line/i)).toBeNull();
    });
  });

  it("does not show a blank dash when linked Reels have no view counts", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      insights_views: null,
      insights_linked: 3,
      insights_fetched_at: "2099-01-01T00:00:00Z",
      ranked: [
        {
          source_id: "winner",
          filename: "winner.mp4",
          insights_views: null,
          insights_linked: 1,
          insights_unknown: 0,
          tracked: [
            {
              index: 1,
              ig_media_id: "m1",
              username: "jeff",
              insights_views: null,
              account_connected: true,
            },
          ],
        },
      ],
      accounts,
    });
    render(<AnalyticsBoard />);
    expect(await screen.findByText(/linked posts, but Instagram sent no view counts/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /winner\.mp4/i }));
    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    expect(within(sheet).getByText(/@jeff · views unknown/i)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /move copy 01 to another original/i })).toBeTruthy();
    expect(within(sheet).queryByText(/^— views/i)).toBeNull();
  });

  it("splits connected handles into account lanes", async () => {
    mockGetInstagramAnalytics.mockResolvedValue({
      ...analytics,
      lanes: [
        {
          ig_user_id: "1",
          username: "jeff",
          insights_views: 300000,
          insights_shares: 80,
          insights_follows: 12,
          insights_linked: 10,
          account_connected: true,
        },
        {
          ig_user_id: "mckenzie",
          username: "mckenzie.trial",
          insights_views: 800,
          insights_linked: 1,
          account_connected: false,
        },
      ],
    });
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));
    const lanes = await screen.findByRole("region", { name: /trial reels/i });
    expect(within(lanes).getByText("@jeff.main")).toBeTruthy();
    expect(within(lanes).getByText(/@mckenzie\.trial · account not connected/i)).toBeTruthy();
    expect(within(lanes).getByText(/account not connected/i)).toBeTruthy();
    expect(lanes.textContent).toMatch(/10 follows/i);
  });

  it("unlinks a tracked copy from a disconnected account", async () => {
    mockUnlinkInstagramMedia.mockResolvedValue({
      ...analytics,
      ranked: [
        {
          ...analytics.ranked[0],
          insights_linked: 11,
          tracked: [analytics.ranked[0]!.tracked![0]!],
        },
        analytics.ranked[1],
      ],
    });
    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));
    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /remove copy 07 from tracking/i }));
    await waitFor(() => {
      expect(mockUnlinkInstagramMedia).toHaveBeenCalledWith({
        source_id: "winner",
        index: 7,
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/mckenzie.trial/i)).toBeNull();
    });
    expect(within(sheet).getByText("copy 03")).toBeTruthy();
  });

  it("moves a tracked Reel onto another Gallery original", async () => {
    mockGetGallery.mockResolvedValue([
      {
        source_id: "winner",
        filename: "winner.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{ index: 7, filename: "v07.mp4", ig_media_id: "mck" }],
      },
      {
        source_id: "jeff",
        filename: "jeff tingz.mp4",
        requested: 1,
        delivered: 1,
        shortfall: 0,
        variants: [{ index: 1, filename: "v01.mp4", ig_media_id: null }],
      },
    ]);
    mockLinkInstagramMedia.mockResolvedValue({
      ...analytics,
      ranked: [
        {
          source_id: "jeff",
          filename: "jeff tingz.mp4",
          insights_views: 800,
          insights_linked: 1,
          tracked: [{
            index: 1,
            ig_media_id: "mck",
            insights_views: 800,
            account_connected: true,
          }],
        },
      ],
    });

    render(<AnalyticsBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /winner.*winner\.mp4/i }));
    const sheet = await screen.findByRole("dialog", { name: /winner\.mp4 insights/i });
    fireEvent.click(within(sheet).getByRole("button", { name: /move copy 07 to another original/i }));
    expect(await within(sheet).findByLabelText(/move to gallery pack/i)).toHaveValue("jeff");
    fireEvent.click(within(sheet).getByRole("button", { name: /^move reel$/i }));

    await waitFor(() => {
      expect(mockLinkInstagramMedia).toHaveBeenCalledWith({
        source_id: "jeff",
        index: 1,
        media_id: "mck",
        ig_user_id: "mckenzie",
        permalink: null,
        username: "mckenzie.trial",
      });
    });
    expect(await screen.findByText("jeff tingz.mp4")).toBeTruthy();
  });
});
