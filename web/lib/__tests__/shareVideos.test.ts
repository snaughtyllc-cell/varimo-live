import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cacheHasAll,
  canShareVideoFiles,
  clearSharedVariantFileCache,
  cloneShareFiles,
  downloadVariantUrls,
  downloadVideoFiles,
  fetchVariantFiles,
  FILE_FETCH_CONCURRENCY,
  filesReadyNow,
  fillFileCache,
  isAppleMobile,
  isRetryableFetchFailure,
  isShareableVideo,
  peekCachedFiles,
  phoneShareHintCopy,
  preparingClipsCopy,
  readyShareableVariants,
  saveNoneSelectedCopy,
  saveOrShareVideoFiles,
  saveTapAction,
  selectedShareableVariants,
  shareClipsReadyCopy,
  shareEmptyCopy,
  shareLoadingCopy,
  sharePrepareBackgroundCopy,
  sharePrepareItemLabel,
  sharePrepareProgressCopy,
  shareRetryCopy,
  shouldOfferPhotosSave,
  sharedVariantFileCache,
  shareVideoFiles,
  shareVideosBusyLabel,
  shareVideosLabel,
  variantDownloadUrl,
  waitUntilDocumentVisible,
  zipSecondaryCopy,
  zipVisibleOnDevice,
} from "@/lib/shareVideos";

const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";

afterEach(() => {
  clearSharedVariantFileCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("canShareVideoFiles", () => {
  it("is false in jsdom when nothing is injected", () => {
    expect(canShareVideoFiles()).toBe(false);
    expect(canShareVideoFiles(undefined)).toBe(false);
    expect(canShareVideoFiles({})).toBe(false);
  });

  it("uses injected canShare with a File probe and does not throw", () => {
    const canShare = vi.fn((data?: { files?: File[] }) => {
      expect(data?.files).toHaveLength(1);
      expect(data?.files?.[0]).toBeInstanceOf(File);
      expect(data?.files?.[0].name).toMatch(/\.mp4$/);
      return true;
    });
    expect(canShareVideoFiles({ canShare })).toBe(true);
    expect(canShare).toHaveBeenCalledTimes(1);
  });

  it("is false when canShare returns false or throws", () => {
    expect(canShareVideoFiles({ canShare: () => false })).toBe(false);
    expect(
      canShareVideoFiles({
        canShare: () => {
          throw new Error("TypeError: cannot share");
        },
      }),
    ).toBe(false);
  });

  it("probes the real files when they are passed", () => {
    const files = [new File(["a"], "v01.mp4", { type: "video/mp4" })];
    const canShare = vi.fn(() => true);
    expect(canShareVideoFiles({ canShare }, files)).toBe(true);
    expect(canShare).toHaveBeenCalledWith({ files });
  });
});

describe("shareVideoFiles", () => {
  it("returns unsupported without a share function or files", async () => {
    const file = new File(["x"], "v01.mp4", { type: "video/mp4" });
    expect(await shareVideoFiles([file])).toBe("unsupported");
    expect(await shareVideoFiles([], async () => {})).toBe("unsupported");
  });

  it("returns shared when shareFn resolves", async () => {
    const file = new File(["x"], "v01.mp4", { type: "video/mp4" });
    const shareFn = vi.fn(async (data: { files: File[] }) => {
      expect(data.files).toHaveLength(1);
      expect(data.files[0].name).toBe("v01.mp4");
      expect(data.files[0].type).toBe("video/mp4");
    });
    expect(await shareVideoFiles([file], shareFn)).toBe("shared");
    expect(shareFn).toHaveBeenCalledTimes(1);
  });

  it("returns aborted on AbortError", async () => {
    const file = new File(["x"], "v01.mp4", { type: "video/mp4" });
    const abort = new DOMException("Share canceled", "AbortError");
    expect(
      await shareVideoFiles([file], async () => {
        throw abort;
      }),
    ).toBe("aborted");
    expect(
      await shareVideoFiles([file], async () => {
        throw { name: "AbortError" };
      }),
    ).toBe("aborted");
  });

  it("returns unsupported on other share failures", async () => {
    const file = new File(["x"], "v01.mp4", { type: "video/mp4" });
    expect(
      await shareVideoFiles([file], async () => {
        throw new Error("NotAllowedError");
      }),
    ).toBe("unsupported");
  });
});

describe("ready shareable variants", () => {
  it("keeps file_ready omitted/true and status ok or omitted", () => {
    expect(isShareableVideo({ file_url: "/a", filename: "a.mp4" })).toBe(true);
    expect(isShareableVideo({ file_url: "/a", filename: "a.mp4", file_ready: true, status: "ok" })).toBe(true);
    expect(isShareableVideo({ file_url: "/a", filename: "a.mp4", file_ready: false })).toBe(false);
    expect(isShareableVideo({ file_url: "/a", filename: "a.mp4", status: "best_effort" })).toBe(false);
    expect(isShareableVideo({ file_url: "/a", filename: "a.mp4", status: "uniqueness_fail" })).toBe(false);
    expect(isShareableVideo({ filename: "a.mp4", status: "ok" })).toBe(false);
  });

  it("filters a pack down to ready mp4s", () => {
    const ready = readyShareableVariants([
      { filename: "v01.mp4", file_url: "/v01.mp4", status: "ok" as const },
      { filename: "v02.mp4", file_url: "/v02.mp4", file_ready: false, status: "ok" as const },
      { filename: "v03.mp4", file_url: "/v03.mp4", status: "corrupt" as const },
    ]);
    expect(ready.map((v) => v.filename)).toEqual(["v01.mp4"]);
  });
});

describe("fetchVariantFiles", () => {
  it("fetches each url as a File named after the variant", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("/api/variants/s1/v01.mp4");
      return new Response("mp4bytes", {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    });
    const files = await fetchVariantFiles(
      [{ file_url: "/api/variants/s1/v01.mp4", filename: "v01.mp4" }],
      fetchFn as unknown as typeof fetch,
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("v01.mp4");
    expect(files[0].type).toMatch(/video\/mp4/);
    expect(await files[0].text()).toBe("mp4bytes");
  });

  it("skips failed fetches", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 404 }));
    const files = await fetchVariantFiles(
      [{ file_url: "/missing.mp4", filename: "v01.mp4" }],
      fetchFn as unknown as typeof fetch,
    );
    expect(files).toEqual([]);
  });

  it("starts every missing clip download before the first one finishes", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchFn = vi.fn(async (url: string) => {
      started += 1;
      await gate;
      return new Response(String(url), { status: 200, headers: { "Content-Type": "video/mp4" } });
    });
    const pending = fetchVariantFiles(
      [
        { file_url: "/a", filename: "v01.mp4" },
        { file_url: "/b", filename: "v02.mp4" },
        { file_url: "/c", filename: "v03.mp4" },
      ],
      fetchFn as unknown as typeof fetch,
    );
    await vi.waitFor(() => expect(started).toBe(3));
    release();
    const files = await pending;
    expect(files.map((file) => file.name)).toEqual(["v01.mp4", "v02.mp4", "v03.mp4"]);
    expect(FILE_FETCH_CONCURRENCY).toBeGreaterThanOrEqual(3);
  });
});

describe("downloadVideoFiles", () => {
  it("triggers an <a download> per file", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-1");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicks: string[] = [];
    const files = [
      new File(["a"], "v01.mp4", { type: "video/mp4" }),
      new File(["b"], "v02.mp4", { type: "video/mp4" }),
    ];
    downloadVideoFiles(files, (a) => {
      clicks.push(`${a.download}@${a.href}`);
    });
    expect(clicks).toEqual(["v01.mp4@blob:test-1", "v02.mp4@blob:test-1"]);
  });
});

describe("cloneShareFiles", () => {
  it("stamps a fresh video/mp4 File only when the name or type is wrong", () => {
    const original = new File(["a"], "v01", { type: "application/octet-stream" });
    const [clone] = cloneShareFiles([original]);
    expect(clone).not.toBe(original);
    expect(clone.name).toBe("v01.mp4");
    expect(clone.type).toBe("video/mp4");
  });

  it("reuses already-correct mp4s so a 20-pack does not double RAM", () => {
    const original = new File(["a"], "v01.mp4", { type: "video/mp4" });
    const [same] = cloneShareFiles([original]);
    expect(same).toBe(original);
  });
});

describe("saveTapAction", () => {
  it("shares on this tap only when clips are already in memory", () => {
    expect(saveTapAction(true, true)).toBe("share");
    expect(saveTapAction(true, false)).toBe("share");
  });

  it("prepares only on iPhone when clips still need to download", () => {
    expect(saveTapAction(false, true)).toBe("prepare");
  });

  it("hands Android and desktop to the OS download manager so leaving the app does not kill the transfer", () => {
    expect(saveTapAction(false, false)).toBe("os_download");
  });
});

describe("background prepare", () => {
  it("retries a killed fetch after the tab is visible again", async () => {
    expect(isRetryableFetchFailure(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isRetryableFetchFailure(new TypeError("Failed to fetch"), false)).toBe(false);
    expect(isRetryableFetchFailure(new Error("404"), false)).toBe(false);

    const listeners = new Set<() => void>();
    const vis = {
      hidden: true,
      addEventListener(_type: string, listener: () => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: string, listener: () => void) {
        listeners.delete(listener);
      },
    };
    const waiting = waitUntilDocumentVisible(vis);
    let resolved = false;
    void waiting.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    vis.hidden = false;
    for (const listener of [...listeners]) listener();
    await waiting;
    expect(resolved).toBe(true);

    let attempts = 0;
    vis.hidden = true;
    const fetchFn = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return new Response("mp4", { status: 200, headers: { "Content-Type": "video/mp4" } });
    });
    const pending = fetchVariantFiles(
      [{ file_url: "/a", filename: "v01.mp4" }],
      fetchFn as unknown as typeof fetch,
      undefined,
      1,
      vis,
    );
    await vi.waitFor(() => expect(attempts).toBe(1));
    vis.hidden = false;
    for (const listener of [...listeners]) listener();
    const files = await pending;
    expect(files).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it("starts OS downloads from the real file URL so the browser keeps them in the background", () => {
    expect(variantDownloadUrl("/api/variants/s1/v01.mp4")).toBe("/api/variants/s1/v01.mp4?dl=1");
    expect(variantDownloadUrl("/api/variants/s1/v01.mp4?x=1")).toBe("/api/variants/s1/v01.mp4?x=1&dl=1");
    const hrefs: string[] = [];
    downloadVariantUrls(
      [
        { file_url: "/api/variants/s1/v01.mp4", filename: "v01.mp4" },
        { file_url: "/api/variants/s1/v02.mp4", filename: "v02.mp4" },
      ],
      (a) => {
        hrefs.push(`${a.download}@${a.href}`);
      },
    );
    expect(hrefs[0]).toContain("v01.mp4");
    expect(hrefs[0]).toContain("dl=1");
    expect(hrefs[1]).toContain("v02.mp4");
  });
});

describe("saveOrShareVideoFiles", () => {
  it("falls back to per-file download when share is unavailable on desktop", async () => {
    const file = new File(["x"], "v01.mp4", { type: "video/mp4" });
    const download = vi.fn();
    expect(
      await saveOrShareVideoFiles([file], {
        download,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
      }),
    ).toEqual({
      result: "downloaded",
      remaining: [],
    });
    expect(download).toHaveBeenCalledWith([file]);
  });

  it("shares every selected clip in one Safari sheet", async () => {
    const files = [
      new File(["a"], "v01.mp4", { type: "video/mp4" }),
      new File(["b"], "v02.mp4", { type: "video/mp4" }),
    ];
    const share = vi.fn(async () => {});
    const download = vi.fn();
    expect(
      await saveOrShareVideoFiles(files, {
        share: { canShare: () => true, share },
        download,
        userAgent: SAFARI_IPHONE,
        maxTouchPoints: 5,
      }),
    ).toEqual({ result: "shared", remaining: [] });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files.map((f: File) => f.name)).toEqual(["v01.mp4", "v02.mp4"]);
    expect(share.mock.calls[0][0]).not.toHaveProperty("title");
    expect(share.mock.calls[0][0]).not.toHaveProperty("url");
    expect(download).not.toHaveBeenCalled();
  });

  it("does not Safari-download when iOS blocks share — keeps clips for another tap", async () => {
    const files = [
      new File(["a"], "v01.mp4", { type: "video/mp4" }),
      new File(["b"], "v02.mp4", { type: "video/mp4" }),
    ];
    const share = vi.fn(async () => {
      throw new DOMException("The request is not allowed", "NotAllowedError");
    });
    const download = vi.fn();
    expect(
      await saveOrShareVideoFiles(files, {
        share: { canShare: () => true, share },
        download,
        userAgent: SAFARI_IPHONE,
        maxTouchPoints: 5,
      }),
    ).toEqual({ result: "needs_gesture", remaining: files, reason: "retry" });
    expect(download).not.toHaveBeenCalled();
  });

  it("still tries the share sheet on Chrome iPhone instead of Drive/Files download", async () => {
    const files = [
      new File(["a"], "v01.mp4", { type: "video/mp4" }),
      new File(["b"], "v02.mp4", { type: "video/mp4" }),
    ];
    const share = vi.fn(async () => {});
    const download = vi.fn();
    expect(
      await saveOrShareVideoFiles(files, {
        share: { share },
        download,
        userAgent: CHROME_IPHONE,
        maxTouchPoints: 5,
      }),
    ).toEqual({ result: "shared", remaining: [] });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files.map((f: File) => f.name)).toEqual(["v01.mp4", "v02.mp4"]);
    expect(download).not.toHaveBeenCalled();
    expect(isAppleMobile(CHROME_IPHONE, 5)).toBe(true);
  });
});

describe("variant file cache", () => {
  it("fills missing urls and peeks without refetching", async () => {
    const cache = new Map<string, File>();
    const variants = [
      { file_url: "/a", filename: "v01.mp4" },
      { file_url: "/b", filename: "v02.mp4" },
    ];
    const fetchFn = vi.fn(async (url: string) => {
      return new Response(url, { status: 200, headers: { "Content-Type": "video/mp4" } });
    });
    expect(cacheHasAll(cache, variants)).toBe(false);
    expect(filesReadyNow(cache, variants)).toBeNull();
    const files = await fillFileCache(cache, variants, fetchFn as unknown as typeof fetch);
    expect(files.map((f) => f.name)).toEqual(["v01.mp4", "v02.mp4"]);
    expect(cacheHasAll(cache, variants)).toBe(true);
    expect(peekCachedFiles(cache, variants)).toEqual(files);
    expect(filesReadyNow(cache, variants)?.map((f) => f.name)).toEqual(["v01.mp4", "v02.mp4"]);
    const pending = [files[1]];
    expect(filesReadyNow(cache, variants, pending)).toEqual(pending);
    fetchFn.mockClear();
    await fillFileCache(cache, variants, fetchFn as unknown as typeof fetch);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reuses the shared clip cache so Select all does not download twice", async () => {
    const file = new File(["a"], "v01.mp4", { type: "video/mp4" });
    sharedVariantFileCache.set("/a", file);
    const cache = new Map<string, File>();
    const fetchFn = vi.fn();
    const files = await fillFileCache(
      cache,
      [{ file_url: "/a", filename: "v01.mp4" }],
      fetchFn as unknown as typeof fetch,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(files[0]).toBe(file);
  });

  it("reports each clip as queued, loading, then ready", async () => {
    const cache = new Map<string, File>();
    const variants = [
      { file_url: "/a", filename: "v01.mp4" },
      { file_url: "/b", filename: "v02.mp4" },
    ];
    const events: Array<{ ready: number; loading: number; states: string[] }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchFn = vi.fn(async (url: string) => {
      if (url === "/a") await firstGate;
      return new Response(url, { status: 200, headers: { "Content-Type": "video/mp4" } });
    });
    const pending = fillFileCache(
      cache,
      variants,
      fetchFn as unknown as typeof fetch,
      (progress) => {
        events.push({
          ready: progress.ready,
          loading: progress.loading,
          states: progress.items.map((item) => `${item.filename}:${item.state}`),
        });
      },
    );
    await vi.waitFor(() => expect(events.some((event) => event.states.includes("v01.mp4:loading"))).toBe(true));
    expect(events[0]?.states).toEqual(["v01.mp4:queued", "v02.mp4:queued"]);
    releaseFirst();
    await pending;
    expect(events.some((event) => event.loading > 0)).toBe(true);
    expect(events.at(-1)).toEqual({
      ready: 2,
      loading: 0,
      states: ["v01.mp4:ready", "v02.mp4:ready"],
    });
  });
});

describe("selectedShareableVariants", () => {
  it("keeps selected ok-ready clips with file urls", () => {
    expect(
      selectedShareableVariants(
        [
          {
            source_id: "s1",
            filename: "a.mp4",
            requested: 2,
            delivered: 2,
            shortfall: 0,
            variants: [
              { filename: "v01.mp4", file_url: "/a", status: "ok", index: 1 } as never,
              { filename: "v02.mp4", file_url: "/b", status: "ok", index: 2 } as never,
              { filename: "v03.mp4", file_url: "/c", status: "best_effort", index: 3 } as never,
            ],
          },
        ],
        new Set(["s1:1", "s1:3"]),
      ),
    ).toEqual([{ file_url: "/a", filename: "v01.mp4" }]);
  });
});

describe("copy", () => {
  it("labels Save to Photos when the share sheet can take videos", () => {
    expect(shareVideosLabel(true)).toBe("Save to Photos");
    expect(shareVideosLabel(false)).toBe("Save to phone");
    expect(shouldOfferPhotosSave({ share: async () => {} })).toBe(true);
    expect(shouldOfferPhotosSave({}, SAFARI_IPHONE, 5)).toBe(true);
    expect(shareVideosBusyLabel()).toBe("Saving…");
    expect(saveNoneSelectedCopy()).toBe("Select clips first");
    expect(preparingClipsCopy()).toBe("Preparing clips…");
    expect(sharePrepareProgressCopy({ total: 20, ready: 3, failed: 0, loading: 1, items: [] })).toBe(
      "Getting clip 4 of 20…",
    );
    expect(sharePrepareProgressCopy({ total: 20, ready: 20, failed: 0, loading: 0, items: [] })).toBe(
      shareClipsReadyCopy(20),
    );
    expect(shareClipsReadyCopy(20)).toMatch(/20 clips ready/i);
    expect(sharePrepareItemLabel("ready")).toBe("Ready");
    expect(sharePrepareItemLabel("loading")).toBe("Getting…");
    expect(sharePrepareItemLabel("queued")).toBe("Waiting");
    expect(sharePrepareItemLabel("failed")).toBe("Missed");
    expect(shareLoadingCopy()).toMatch(/Preparing clips/i);
    expect(shareRetryCopy()).toMatch(/Tap Save to Photos again/i);
    expect(phoneShareHintCopy()).toMatch(/Save Videos/i);
    expect(shareRetryCopy() + shareLoadingCopy()).not.toMatch(/Diagnostics/i);
  });

  it("keeps ZIP as a secondary desktop action and names the Files-app trap", () => {
    expect(zipSecondaryCopy()).toMatch(/ZIP/i);
    expect(zipSecondaryCopy()).toMatch(/desktop/i);
    expect(zipSecondaryCopy()).toMatch(/Files/i);
    expect(phoneShareHintCopy()).toMatch(/Save Video/i);
    expect(phoneShareHintCopy()).toMatch(/Photos/i);
    expect(sharePrepareBackgroundCopy()).toMatch(/leave|switch apps|come back/i);
    expect(zipVisibleOnDevice(() => ({ matches: true }))).toBe(false);
    expect(zipVisibleOnDevice(() => ({ matches: false }))).toBe(true);
    expect(zipVisibleOnDevice(undefined)).toBe(true);
    expect(zipSecondaryCopy() + phoneShareHintCopy() + shareEmptyCopy()).not.toMatch(/Diagnostics/i);
  });
});
