import { describe, it, expect } from "vitest";
import type { QueueSnapshot } from "@/lib/types";
import {
  jobIsLive,
  jobCanCancel,
  jobsAhead,
  queueHeadline,
  queueOccupiesHq,
  queueRowLabel,
  queueStripLabel,
  queueWaitCopy,
} from "@/lib/queue";

function snap(over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return { running: 0, fast: 0, hq: 0, jobs: [], ...over };
}

const fastJob = {
  job_id: "aaa",
  quality_mode: "fast" as const,
  state: "running",
  created_utc: "2026-08-20T02:00:00Z",
  count: 8,
  source_count: 1,
  filenames: ["IMG_0683_proxy.mp4"],
  delivered: 3,
  requested: 8,
  position: 1,
};

const hqJob = {
  job_id: "bbb",
  quality_mode: "hq" as const,
  state: "running",
  created_utc: "2026-08-20T02:01:00Z",
  count: 5,
  source_count: 1,
  filenames: ["partner.mov"],
  delivered: 0,
  requested: 5,
  position: 2,
};

describe("live Studio queue copy", () => {
  it("idle strip is empty; one Fast pack shows progress without a video", () => {
    expect(queueStripLabel(snap())).toBeNull();
    expect(queueStripLabel(snap({ running: 1, fast: 1, jobs: [fastJob] }))).toBe(
      "1 gen · Fast 3/8",
    );
    expect(queueStripLabel(snap({ running: 2, fast: 1, hq: 1, jobs: [fastJob, hqJob] }))).toBe(
      "2 generating",
    );
  });

  it("counts packs ahead of you without requiring a login", () => {
    const q = snap({ running: 2, fast: 1, hq: 1, jobs: [fastJob, hqJob] });
    expect(jobsAhead(q, null)).toBe(2);
    expect(jobsAhead(q, "aaa")).toBe(0);
    expect(jobsAhead(q, "bbb")).toBe(1);
  });

  it("treats queued and cancel-requested as live packs", () => {
    expect(jobIsLive("queued")).toBe(true);
    expect(jobIsLive("reserved")).toBe(true);
    expect(jobIsLive("cancel_requested")).toBe(true);
    expect(jobIsLive("done")).toBe(false);
    expect(jobCanCancel("queued")).toBe(true);
    expect(jobCanCancel("starting")).toBe(true);
    expect(jobCanCancel("running")).toBe(true);
    expect(jobCanCancel("cancel_requested")).toBe(false);
    expect(jobCanCancel("done")).toBe(false);
    expect(queueRowLabel({ ...fastJob, state: "queued" })).toBe(
      "1. Fast · IMG_0683.mp4 · waiting",
    );
  });

  it("same studio waits; a second studio can still take the other Fast worker", () => {
    const twoFast = snap({
      running: 2,
      fast: 2,
      jobs: [fastJob, { ...fastJob, job_id: "ccc", position: 2, filenames: ["va.mp4"] }],
    });
    expect(queueHeadline(twoFast)).toBe("2 packs generating");
    expect(queueWaitCopy(twoFast, "fast", "ccc")).toMatch(/waits/i);
    expect(queueWaitCopy(twoFast, "fast", "aaa")).toMatch(/waits in line/i);
    expect(queueRowLabel(fastJob)).toBe("1. Fast · IMG_0683.mp4 · 3/8");
  });

  it("HQ waits on the one GPU; this studio does not start a second pack", () => {
    const q = snap({ running: 1, hq: 1, jobs: [{ ...hqJob, position: 1 }] });
    expect(queueWaitCopy(q, "hq")).toMatch(/GPU/i);
    expect(queueWaitCopy(q, "hq")).toMatch(/waits/i);
    expect(queueWaitCopy(q, "fast", "bbb")).toMatch(/waits in line|generating/i);
  });

  it("idle copy says one pack per studio and packs do not overwrite", () => {
    expect(queueWaitCopy(snap(), "fast")).toMatch(/one pack/i);
    expect(queueWaitCopy(snap(), "fast")).toMatch(/do not overwrite/i);
  });

  it("counts reconstruct-first as HQ occupancy until prep is done", () => {
    const reconstructing = {
      ...fastJob,
      prep_mode: "hq" as const,
      prep_status: "running" as const,
    };
    expect(queueOccupiesHq(reconstructing)).toBe(true);
    expect(queueRowLabel(reconstructing)).toBe("1. HQ · IMG_0683.mp4 · 3/8");
    expect(queueOccupiesHq({ ...reconstructing, prep_status: "done" })).toBe(false);
    expect(queueRowLabel({ ...reconstructing, prep_status: "done" })).toBe(
      "1. Fast · IMG_0683.mp4 · 3/8",
    );
  });
});
