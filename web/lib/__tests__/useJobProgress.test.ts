import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useJobProgress } from "@/lib/useJobProgress";

class MockES {
  static last: MockES | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) { MockES.last = this; }
  close() { this.closed = true; }
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
beforeEach(() => { (globalThis as any).EventSource = MockES as any; MockES.last = null; });

describe("useJobProgress", () => {
  const sources = [{ source_id: "s1", filename: "a.mp4", requested: 1 }];
  it("reduces streamed events and closes on job-done", () => {
    const { result } = renderHook(() => useJobProgress("j1", sources));
    expect(MockES.last?.url).toBe("/api/jobs/j1/events");
    act(() => { MockES.last!.emit({ source_id: "s1", index: 1, state: "rendering", attempt: 0, max_attempts: 0, status: null, quality: null, filename: null }); });
    expect(result.current.bySource.s1.inFlight?.state).toBe("rendering");
    act(() => { MockES.last!.emit({ source_id: "s1", index: 1, state: "done", attempt: 0, max_attempts: 0, status: "ok", quality: { vmaf: 95, histogram_ok: true, regen_count: 0, passed: true, spatial_vmaf: null, spatial_ok: null }, filename: "v01.mp4" }); });
    expect(result.current.bySource.s1.delivered).toBe(1);
    act(() => { MockES.last!.emit({ state: "job-done" }); });
    expect(result.current.complete).toBe(true);
    expect(MockES.last!.closed).toBe(true);
  });
  it("does nothing when jobId is null", () => {
    const { result } = renderHook(() => useJobProgress(null, sources));
    expect(MockES.last).toBeNull();
    expect(result.current.bySource).toEqual({});
  });

  it("drops stale queued tiles when the job is cleared", () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useJobProgress(id, sources),
      { initialProps: { id: "j1" as string | null } },
    );
    expect(result.current.bySource.s1.requested).toBe(1);
    rerender({ id: null });
    expect(result.current.bySource).toEqual({});
  });
  it("waits until sources are known before opening", () => {
    renderHook(() => useJobProgress("j1", []));
    expect(MockES.last).toBeNull();
  });

  it("clears v01 rendering when poll says the job is done (GPU timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        job_id: "j1", count: 1, created_utc: "", state: "done",
        error: "GPU job failed or hit the 20-minute limit.",
        sources: [{
          source_id: "s1", filename: "a.mp4", requested: 1, delivered: 0, shortfall: 1,
          variants: [],
          in_flight: { index: 1, state: "rendering", attempt: 0, max_attempts: 0 },
        }],
      }), { status: 200 }),
    );
    const { result } = renderHook(() => useJobProgress("j1", sources));
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    expect(result.current.bySource.s1.inFlight).toBeUndefined();
    expect(result.current.bySource.s1.inFlights).toEqual({});
    expect(result.current.failed).toMatch(/20-minute/);
  });

  it("clears v01 rendering when poll says the job was cancelled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        job_id: "j1", count: 1, created_utc: "", state: "cancelled",
        error: "Cancelled — New run when you want another pack.",
        sources: [{
          source_id: "s1", filename: "a.mp4", requested: 1, delivered: 0, shortfall: 1,
          variants: [],
          in_flight: { index: 1, state: "rendering", attempt: 0, max_attempts: 0 },
        }],
      }), { status: 200 }),
    );
    const { result } = renderHook(() => useJobProgress("j1", sources));
    await waitFor(() => {
      expect(result.current.complete).toBe(true);
    });
    expect(result.current.bySource.s1.inFlight).toBeUndefined();
    expect(result.current.bySource.s1.inFlights).toEqual({});
    expect(result.current.failed).toMatch(/Cancelled/);
  });

  it("keeps every live copy from in_flights on poll", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        job_id: "j1", count: 8, created_utc: "", state: "running",
        sources: [{
          source_id: "s1", filename: "a.mp4", requested: 8, delivered: 0, shortfall: 8,
          variants: [],
          in_flight: { index: 2, state: "rendering", attempt: 0, max_attempts: 0 },
          in_flights: [
            { index: 1, state: "rendering", attempt: 0, max_attempts: 0 },
            { index: 2, state: "rendering", attempt: 0, max_attempts: 0 },
          ],
        }],
      }), { status: 200 }),
    );
    const { result } = renderHook(() =>
      useJobProgress("j1", [{ source_id: "s1", filename: "a.mp4", requested: 8 }]),
    );
    await waitFor(() => {
      expect(Object.keys(result.current.bySource.s1.inFlights)).toHaveLength(2);
    });
    expect(result.current.bySource.s1.inFlights[1]?.state).toBe("rendering");
    expect(result.current.bySource.s1.inFlights[2]?.state).toBe("rendering");
    expect(result.current.complete).toBe(false);
  });

  it("does not construct EventSource for a preparing jobId", () => {
    const { result, unmount } = renderHook(() => useJobProgress("preparing", sources));
    expect(MockES.last).toBeNull();
    expect(result.current.complete).toBe(false);
    expect(result.current.bySource.s1.requested).toBe(1);
    unmount();
  });
});
