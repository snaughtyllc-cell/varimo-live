import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SourceOut, VariantOut } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  regenerate: vi.fn(),
  retryCopy: vi.fn(),
  sourceUrl: () => "/api/source/s1",
  sourceZipUrl: () => "/api/sources/s1/zip",
  removeSource: vi.fn(),
  rewriteSourceCaptions: vi.fn(),
}));

import { SourceGroup } from "@/components/gallery/SourceGroup";
import { phoneShareHintCopy, zipSecondaryCopy } from "@/lib/shareVideos";

const quality = {
  vmaf: 95,
  histogram_ok: true,
  regen_count: 0,
  passed: true,
  spatial_vmaf: null,
  spatial_ok: true,
};

function variant(over: Partial<VariantOut> = {}): VariantOut {
  return {
    index: 1,
    filename: "v01.mp4",
    status: "ok",
    quality,
    file_url: "/api/variants/s1/v01.mp4",
    file_ready: true,
    ...over,
  };
}

function source(over: Partial<SourceOut> = {}): SourceOut {
  return {
    source_id: "s1",
    filename: "clip.mp4",
    requested: 2,
    delivered: 2,
    shortfall: 0,
    files_ready: 2,
    job_state: "done",
    copy_status: "ok",
    variants: [
      variant(),
      variant({ index: 2, filename: "v02.mp4", file_url: "/api/variants/s1/v02.mp4" }),
    ],
    ...over,
  };
}

const noop = () => {};
const props = {
  onOpenVariant: noop,
  onRegenerate: noop,
  selected: new Set<string>(),
  onToggleVariant: noop,
  onToggleSelectSource: noop,
  onRemove: noop,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
});

describe("SourceGroup phone save/share", () => {
  it("shows Save to phone as the pack action and ZIP as a quieter secondary on desktop", () => {
    render(<SourceGroup source={source()} {...props} />);
    expect(screen.getByRole("button", { name: /save to phone/i })).toBeInTheDocument();
    const zip = screen.getByRole("link", { name: /download zip/i });
    expect(zip).toHaveAttribute("href", "/api/sources/s1/zip");
    expect(zip.getAttribute("title")).toBe(zipSecondaryCopy());
    expect(zip).toHaveClass("gallery-zip-link");
    expect(screen.getByRole("button", { name: /save to phone/i }).getAttribute("title")).toBe(
      phoneShareHintCopy(),
    );
    expect(screen.getByRole("button", { name: /select all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^options$/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Diagnostics/i);
  });

  it("labels Save to Photos when the browser can share files", () => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    render(<SourceGroup source={source()} {...props} />);
    expect(screen.getByRole("button", { name: /save to photos/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save to phone/i })).not.toBeInTheDocument();
  });

  it("hides ZIP on coarse-pointer (phone) devices", async () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as MediaQueryList);
    render(<SourceGroup source={source()} {...props} />);
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /download zip/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /save to phone/i })).toBeInTheDocument();
  });

  it("hides Save to phone while the job is still running", () => {
    render(
      <SourceGroup
        source={source({ job_state: "running", in_flight: { index: 3, state: "rendering", attempt: 0, max_attempts: 2 } })}
        {...props}
      />,
    );
    expect(screen.queryByRole("button", { name: /save to phone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download zip/i })).not.toBeInTheDocument();
  });

  it("fetches ready mp4s and downloads each file when share is unavailable", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return new Response(url, {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    });
    const downloads: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:dl");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const protoClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download) downloads.push(this.download);
    };

    try {
      render(<SourceGroup source={source()} {...props} />);
      fireEvent.click(screen.getByRole("button", { name: /save to phone/i }));

      await waitFor(() => {
        expect(downloads).toEqual(["v01.mp4", "v02.mp4"]);
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/variants/s1/v01.mp4");
      expect(fetchMock).toHaveBeenCalledWith("/api/variants/s1/v02.mp4");
    } finally {
      HTMLAnchorElement.prototype.click = protoClick;
    }
  });

  it("shares File objects when canShare accepts them", async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    vi.mocked(fetch).mockImplementation(async () =>
      new Response("vid", { status: 200, headers: { "Content-Type": "video/mp4" } }),
    );

    render(<SourceGroup source={source()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /save to photos/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0] as { files: File[]; title?: string; url?: string };
    expect(payload.files.map((f) => f.name)).toEqual(["v01.mp4", "v02.mp4"]);
    expect(payload.title).toBeUndefined();
    expect(payload.url).toBeUndefined();
  });

  it("does not fetch variants that are not ready or not ok", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("x", { status: 200, headers: { "Content-Type": "video/mp4" } }),
    );
    render(
      <SourceGroup
        source={source({
          files_ready: 1,
          variants: [
            variant({ file_ready: false }),
            variant({ index: 2, filename: "v02.mp4", file_url: "/api/variants/s1/v02.mp4", status: "best_effort" }),
            variant({ index: 3, filename: "v03.mp4", file_url: "/api/variants/s1/v03.mp4" }),
          ],
        })}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save to phone/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.every((url) => url === "/api/variants/s1/v03.mp4")).toBe(true);
    expect(urls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SourceGroup live post count", () => {
  it("shows how many variants have a pasted permalink", () => {
    render(
      <SourceGroup
        source={source({
          variants: [
            variant({ post_url: "https://www.instagram.com/reel/a/" }),
            variant({
              index: 2,
              filename: "v02.mp4",
              file_url: "/api/variants/s1/v02.mp4",
              post_url: "https://www.tiktok.com/@x/video/1",
            }),
          ],
        })}
        {...props}
      />,
    );
    expect(screen.getByText(/2 live posts/i)).toBeInTheDocument();
  });
});
