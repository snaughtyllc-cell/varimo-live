import { previewTime } from "./media";

const POSTER_MAX_EDGE = 360;

/**
 * Decode one frame of a local File into a JPEG data URL.
 * iOS Safari often leaves a <video src=blob> black; a still image always paints.
 */
export async function captureVideoPoster(
  file: File,
  timeoutMs = 4000,
): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    };

    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(reason));
    };

    const snap = () => {
      if (settled) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail("no-canvas");
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const poster = canvas.toDataURL("image/jpeg", 0.72);
        if (!poster || poster === "data:,") {
          fail("empty-poster");
          return;
        }
        settled = true;
        cleanup();
        resolve(poster);
      } catch {
        fail("draw");
      }
    };

    const timer = window.setTimeout(() => fail("timeout"), timeoutMs);
    video.addEventListener("error", () => fail("load"), { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        const t = previewTime(video.duration);
        const onFrame = () => snap();
        video.addEventListener("seeked", onFrame, { once: true });
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => void;
          }
        ).requestVideoFrameCallback;
        if (typeof rvfc === "function") {
          rvfc.call(video, onFrame);
        }
        try {
          if (Math.abs(video.currentTime - t) < 0.02) {
            video.currentTime = t === 0 ? 0.01 : 0;
          }
          video.currentTime = t;
        } catch {
          snap();
        }
      },
      { once: true },
    );

    document.body.appendChild(video);
    video.src = url;
    video.load();
  });
}
