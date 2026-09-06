import { isFileReady } from "./gallery";
import type { SourceOut } from "./types";

export type ShareNavigatorLike = {
  canShare?: (data?: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

export type ShareFn = (data: { files: File[] }) => Promise<void>;

export type ShareVideoResult = "shared" | "aborted" | "unsupported";

export type ShareableVariant = {
  filename: string;
  file_url?: string;
  file_ready?: boolean;
  status?: string;
};

export type SaveOrShareResult = ShareVideoResult | "downloaded" | "needs_gesture";

export type SaveOrShareOutcome = {
  result: SaveOrShareResult;
  remaining: File[];
  reason?: "retry";
};

export type VariantFileRef = { file_url: string; filename: string };

export type ClipPrepareState = "queued" | "loading" | "ready" | "failed";

export type ClipPrepareItem = {
  filename: string;
  file_url: string;
  state: ClipPrepareState;
};

export type FileCacheProgress = {
  total: number;
  ready: number;
  failed: number;
  loading: number;
  current?: string;
  items: ClipPrepareItem[];
};

export const FILE_FETCH_CONCURRENCY = 6;
export const FILE_FETCH_CONCURRENCY_APPLE = 2;

export type SaveTapAction = "share" | "prepare" | "prepare_then_save" | "os_download";

export type VisibilitySource = {
  hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** iPhone: never share after an async fetch — Safari drops the gesture and weaker phones OOM.
 *  Android/desktop: hand the real URL to the OS download manager so leaving the app
 *  does not kill an in-page blob fetch. */
export function saveTapAction(ready: boolean, appleMobile: boolean): SaveTapAction {
  if (ready) return "share";
  return appleMobile ? "prepare" : "os_download";
}

export function defaultVisibility(): VisibilitySource | null {
  if (typeof document === "undefined") return null;
  return document;
}

export function isRetryableFetchFailure(err: unknown, hidden = false): boolean {
  if (hidden) return true;
  return isAbortError(err);
}

export function waitUntilDocumentVisible(
  visibility?: VisibilitySource | null,
): Promise<void> {
  const doc = visibility ?? defaultVisibility();
  if (!doc || !doc.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (!doc.hidden) {
        doc.removeEventListener("visibilitychange", onChange);
        resolve();
      }
    };
    doc.addEventListener("visibilitychange", onChange);
  });
}

export function variantDownloadUrl(fileUrl: string, query = "dl=1"): string {
  const join = fileUrl.includes("?") ? "&" : "?";
  return `${fileUrl}${join}${query}`;
}

export function downloadVariantUrls(
  variants: VariantFileRef[],
  click?: (anchor: HTMLAnchorElement) => void,
): void {
  const trigger = click ?? ((a) => a.click());
  for (const variant of variants) {
    const a = document.createElement("a");
    a.href = variantDownloadUrl(variant.file_url);
    a.download = shareFileName(variant.filename);
    a.rel = "noopener";
    document.body.appendChild(a);
    trigger(a);
    a.remove();
  }
}

export const sharedVariantFileCache = new Map<string, File>();

const fetchInflight = new Map<string, Promise<File | null>>();

export function clearSharedVariantFileCache(): void {
  sharedVariantFileCache.clear();
  fetchInflight.clear();
}

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError";
}

export function isAppleMobile(ua = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && maxTouchPoints > 1;
}

export function hasShareMethod(share?: ShareNavigatorLike | null): boolean {
  return Boolean(share && typeof share.share === "function");
}

export function shouldOfferPhotosSave(
  share?: ShareNavigatorLike | null,
  ua = "",
  maxTouchPoints = 0,
): boolean {
  return hasShareMethod(share) || canShareVideoFiles(share) || isAppleMobile(ua, maxTouchPoints);
}

export function canShareVideoFiles(
  share?: ShareNavigatorLike | null,
  files?: File[],
): boolean {
  if (!share || typeof share.canShare !== "function") return false;
  if (typeof File === "undefined") return false;
  try {
    const probe =
      files && files.length > 0
        ? files
        : [new File(["x"], "probe.mp4", { type: "video/mp4" })];
    return share.canShare({ files: probe }) === true;
  } catch {
    return false;
  }
}

export function cloneShareFiles(files: File[]): File[] {
  return files.map((file) => {
    const name = file.name.toLowerCase().endsWith(".mp4") ? file.name : `${file.name}.mp4`;
    if (file.type === "video/mp4" && name === file.name) return file;
    return new File([file], name, { type: "video/mp4", lastModified: Date.now() });
  });
}

export async function shareVideoFiles(
  files: File[],
  shareFn?: ShareFn,
): Promise<ShareVideoResult> {
  if (!shareFn || files.length === 0) return "unsupported";
  try {
    // Files only — title/text/url on iOS often routes the sheet to Files or Drive.
    await shareFn({ files: cloneShareFiles(files) });
    return "shared";
  } catch (err) {
    if (isAbortError(err)) return "aborted";
    return "unsupported";
  }
}

export function isShareableVideo<T extends ShareableVariant>(
  variant: T,
): variant is T & { file_url: string } {
  if (!isFileReady(variant)) return false;
  if (variant.status != null && variant.status !== "ok") return false;
  return Boolean(variant.file_url);
}

export function readyShareableVariants<T extends ShareableVariant>(
  variants: T[],
): Array<T & { file_url: string }> {
  return variants.filter(isShareableVideo);
}

export function selectedShareableVariants(
  sources: SourceOut[],
  selected: Set<string>,
): Array<{ file_url: string; filename: string }> {
  const out: Array<{ file_url: string; filename: string }> = [];
  for (const source of sources) {
    for (const variant of source.variants) {
      if (!selected.has(`${source.source_id}:${variant.index}`)) continue;
      if (!isShareableVideo(variant)) continue;
      out.push({ file_url: variant.file_url, filename: variant.filename });
    }
  }
  return out;
}

function shareFileName(filename: string): string {
  return filename.toLowerCase().endsWith(".mp4") ? filename : `${filename}.mp4`;
}

export function fileCacheProgress(
  variants: VariantFileRef[],
  cache: Map<string, File>,
  loading: Iterable<string> = [],
  failed: Iterable<string> = [],
): FileCacheProgress {
  const loadingSet = new Set(loading);
  const failedSet = new Set(failed);
  const items: ClipPrepareItem[] = variants.map((variant) => {
    let state: ClipPrepareState = "queued";
    if (cache.has(variant.file_url)) state = "ready";
    else if (failedSet.has(variant.file_url)) state = "failed";
    else if (loadingSet.has(variant.file_url)) state = "loading";
    return { filename: variant.filename, file_url: variant.file_url, state };
  });
  return {
    total: variants.length,
    ready: items.filter((item) => item.state === "ready").length,
    failed: items.filter((item) => item.state === "failed").length,
    loading: items.filter((item) => item.state === "loading").length,
    current: items.find((item) => item.state === "loading")?.filename,
    items,
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await worker(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: items.length === 0 ? 0 : n }, () => run()));
  return out;
}

async function fetchVariantFile(
  variant: VariantFileRef,
  fetchFn: typeof fetch,
  visibility?: VisibilitySource | null,
): Promise<File | null> {
  const shared = sharedVariantFileCache.get(variant.file_url);
  if (shared) return shared;
  const pending = fetchInflight.get(variant.file_url);
  if (pending) return pending;
  const task = (async () => {
    for (;;) {
      const hidden = Boolean(visibility?.hidden);
      try {
        const res = await fetchFn(variant.file_url, { cache: "force-cache" });
        if (res && res.ok) {
          const buf = await res.arrayBuffer();
          const file = new File([buf], shareFileName(variant.filename), { type: "video/mp4" });
          sharedVariantFileCache.set(variant.file_url, file);
          return file;
        }
        if (!hidden) return null;
      } catch (err) {
        if (!isRetryableFetchFailure(err, hidden)) return null;
      }
      await waitUntilDocumentVisible(visibility);
    }
  })();
  fetchInflight.set(variant.file_url, task);
  try {
    return await task;
  } finally {
    fetchInflight.delete(variant.file_url);
  }
}

export async function fetchVariantFiles(
  variants: { file_url: string; filename: string }[],
  fetchFn?: typeof fetch,
  onProgress?: (progress: FileCacheProgress) => void,
  concurrency = FILE_FETCH_CONCURRENCY,
  visibility?: VisibilitySource | null,
): Promise<File[]> {
  const fetchImpl = fetchFn ?? globalThis.fetch.bind(globalThis);
  const vis = visibility === undefined ? defaultVisibility() : visibility;
  const cache = new Map<string, File>();
  const loading = new Set<string>();
  const failed = new Set<string>();
  const emit = () => onProgress?.(fileCacheProgress(variants, cache, loading, failed));
  emit();
  const results = await mapPool(variants, concurrency, async (variant) => {
    loading.add(variant.file_url);
    emit();
    const file = await fetchVariantFile(variant, fetchImpl, vis);
    loading.delete(variant.file_url);
    if (file) cache.set(variant.file_url, file);
    else failed.add(variant.file_url);
    emit();
    return file;
  });
  return results.filter((file): file is File => Boolean(file));
}

export function downloadVideoFiles(
  files: File[],
  click?: (anchor: HTMLAnchorElement) => void,
): void {
  const trigger = click ?? ((a) => a.click());
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    trigger(a);
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function peekCachedFiles(
  cache: Map<string, File>,
  variants: VariantFileRef[],
): File[] {
  const files: File[] = [];
  for (const variant of variants) {
    const hit = cache.get(variant.file_url);
    if (!hit) return [];
    files.push(hit);
  }
  return files;
}

export function cacheHasAll(cache: Map<string, File>, variants: VariantFileRef[]): boolean {
  return variants.length > 0 && variants.every((variant) => cache.has(variant.file_url));
}

export async function fillFileCache(
  cache: Map<string, File>,
  variants: VariantFileRef[],
  fetchFn?: typeof fetch,
  onProgress?: (progress: FileCacheProgress) => void,
  concurrency = FILE_FETCH_CONCURRENCY,
  visibility?: VisibilitySource | null,
): Promise<File[]> {
  const fetchImpl = fetchFn ?? globalThis.fetch.bind(globalThis);
  const vis = visibility === undefined ? defaultVisibility() : visibility;
  for (const variant of variants) {
    if (cache.has(variant.file_url)) continue;
    const shared = sharedVariantFileCache.get(variant.file_url);
    if (shared) cache.set(variant.file_url, shared);
  }
  const loading = new Set<string>();
  const failed = new Set<string>();
  const emit = () => onProgress?.(fileCacheProgress(variants, cache, loading, failed));
  emit();
  const missing = variants.filter((variant) => !cache.has(variant.file_url));
  if (missing.length > 0) {
    await fetchVariantFiles(
      missing,
      fetchImpl,
      (partial) => {
        loading.clear();
        failed.clear();
        for (const item of partial.items) {
          if (item.state === "ready") {
            const file = sharedVariantFileCache.get(item.file_url);
            if (file) cache.set(item.file_url, file);
          }
          if (item.state === "loading") loading.add(item.file_url);
          if (item.state === "failed") failed.add(item.file_url);
        }
        emit();
      },
      concurrency,
      vis,
    );
    emit();
  }
  return variants.map((variant) => cache.get(variant.file_url)).filter((file): file is File => Boolean(file));
}

export function filesReadyNow(
  cache: Map<string, File>,
  variants: VariantFileRef[],
  pending?: File[] | null,
): File[] | null {
  if (pending && pending.length > 0) return pending;
  if (cacheHasAll(cache, variants)) return peekCachedFiles(cache, variants);
  return null;
}

export async function saveOrShareVideoFiles(
  files: File[],
  options?: {
    share?: ShareNavigatorLike | null;
    download?: (files: File[]) => void;
    userAgent?: string;
    maxTouchPoints?: number;
  },
): Promise<SaveOrShareOutcome> {
  if (files.length === 0) return { result: "unsupported", remaining: [] };
  const ua =
    options?.userAgent ??
    (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const touch =
    options?.maxTouchPoints ??
    (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints);
  const apple = isAppleMobile(ua, touch);
  const shareNav = options?.share;
  const shareFn =
    shareNav && typeof shareNav.share === "function" ? shareNav.share.bind(shareNav) : undefined;
  if (shareFn) {
    const result = await shareVideoFiles(files, shareFn);
    if (result === "shared" || result === "aborted") {
      return { result, remaining: [] };
    }
    // Gesture dropped or WebKit spent the last share. Keep the mp4s for a
    // fresh tap — never <a download> on iPhone (that is Files).
    if (apple) return { result: "needs_gesture", remaining: files, reason: "retry" };
    (options?.download ?? downloadVideoFiles)(files);
    return { result: "downloaded", remaining: [] };
  }
  if (apple) return { result: "needs_gesture", remaining: files, reason: "retry" };
  (options?.download ?? downloadVideoFiles)(files);
  return { result: "downloaded", remaining: [] };
}

export function shareVideosLabel(offerPhotos: boolean): string {
  return offerPhotos ? "Save to Photos" : "Save to phone";
}

export function shareVideosBusyLabel(): string {
  return "Saving…";
}

export function preparingClipsCopy(): string {
  return "Preparing clips…";
}

export function shareClipsReadyCopy(ready: number): string {
  const noun = ready === 1 ? "clip" : "clips";
  return `${ready} ${noun} ready. Tap Save to Photos.`;
}

export function sharePrepareBackgroundCopy(): string {
  return "If you switch apps, we'll pick up when you come back.";
}

export function sharePrepareProgressCopy(
  progress: Pick<FileCacheProgress, "total" | "ready" | "failed" | "loading">,
): string {
  if (progress.total <= 0) return preparingClipsCopy();
  if (progress.ready + progress.failed >= progress.total) {
    return shareClipsReadyCopy(progress.ready);
  }
  const n = Math.min(progress.total, Math.max(1, progress.ready + progress.loading));
  return `Getting clip ${n} of ${progress.total}…`;
}

export function sharePrepareItemLabel(state: ClipPrepareState): string {
  if (state === "ready") return "Ready";
  if (state === "loading") return "Getting…";
  if (state === "failed") return "Missed";
  return "Waiting";
}

export function zipVisibleOnDevice(
  matchMedia?: ((query: string) => { matches: boolean }) | null,
): boolean {
  return matchMedia?.("(pointer: coarse)")?.matches !== true;
}

export function zipSecondaryCopy(): string {
  return "Desktop ZIP of the pack. On a phone ZIP lands in Files — use Save to Photos instead.";
}

export function phoneShareHintCopy(): string {
  return "Select the clips, tap Save to Photos, then tap Save Videos on the share sheet. Skip Files and Drive.";
}

export function shareEmptyCopy(): string {
  return "Those videos never copied back from the GPU. Wait a moment and try again, or Regenerate.";
}

export function saveNoneSelectedCopy(): string {
  return "Select clips first";
}

export function shareRetryCopy(): string {
  return "Clips are ready. Tap Save to Photos again to open the share sheet — skip the Safari download.";
}

export function shareLoadingCopy(): string {
  return "Preparing clips… tap Save to Photos when this note is gone.";
}

export function shareOutcomeMessage(outcome: SaveOrShareOutcome): string | null {
  if (outcome.result !== "needs_gesture") return null;
  return shareRetryCopy();
}
