import type { QueueItem, QueueSnapshot } from "./types";

/** iPhone uploads often land as stem_proxy.mp4 after normalize — show the clip name. */
export function displayClipName(filename: string): string {
  return filename.replace(/_proxy(?=\.[^.]+$)/, "");
}

export function jobIsLive(state?: string | null): boolean {
  return (
    state === "running" ||
    state === "queued" ||
    state === "reserved" ||
    state === "starting" ||
    state === "uploading" ||
    state === "cancel_requested"
  );
}

export function jobCanCancel(state?: string | null): boolean {
  return jobIsLive(state) && state !== "cancel_requested";
}

export function jobsAhead(queue: QueueSnapshot, myJobId?: string | null): number {
  if (!myJobId) return queue.running;
  const mine = queue.jobs.find((j) => j.job_id === myJobId);
  if (!mine) return queue.running;
  return Math.max(0, mine.position - 1);
}

export function queueHeadline(queue: QueueSnapshot): string {
  if (queue.running === 0) return "Studio is free";
  if (queue.running === 1) return "1 pack generating";
  return `${queue.running} packs generating`;
}

export function queueOccupiesHq(job: {
  quality_mode?: string;
  prep_mode?: string;
  prep_status?: string | null;
}): boolean {
  if (job.quality_mode === "hq") return true;
  return job.prep_mode === "hq" && job.prep_status !== "done";
}

export function queueRowLabel(job: QueueItem): string {
  const names = job.filenames.map(displayClipName).join(", ") || "clip";
  const mode = queueOccupiesHq(job) ? "HQ" : "Fast";
  const waiting = job.state === "queued" || job.state === "reserved";
  if (waiting) {
    return `${job.position}. ${mode} · ${names} · waiting`;
  }
  return `${job.position}. ${mode} · ${names} · ${job.delivered}/${job.requested}`;
}

export function queueStripLabel(queue: QueueSnapshot): string | null {
  if (queue.running === 0) return null;
  if (queue.running === 1 && queue.jobs[0]) {
    const j = queue.jobs[0];
    const mode = queueOccupiesHq(j) ? "HQ" : "Fast";
    return `1 gen · ${mode} ${j.delivered}/${j.requested}`;
  }
  return `${queue.running} generating`;
}

export function queueWaitCopy(
  queue: QueueSnapshot,
  qualityMode: "fast" | "hq",
  myJobId?: string | null,
): string {
  const mine = myJobId ? queue.jobs.find((j) => j.job_id === myJobId) : undefined;
  if (queue.running === 0) {
    return "This studio runs one pack at a time. A second studio can still use the other Fast worker. Packs do not overwrite each other.";
  }
  if (mine && mine.position > 1) {
    return "This studio already has a pack going. Yours waits until that pack finishes — cancel the live one if you need this pack first.";
  }
  if (qualityMode === "hq") {
    return "HQ is on the one GPU. Another pack from this studio waits; a second studio can still run Fast.";
  }
  return "Your Fast pack is generating. Another Generate from this studio waits in line.";
}
