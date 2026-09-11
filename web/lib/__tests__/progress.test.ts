import { describe, it, expect } from "vitest";
import { initRun, reduceEvent, runDeliveredNone, runHasStarted } from "@/lib/progress";
import { VariantEvent } from "@/lib/types";

const q = { vmaf: 95, histogram_ok: true, regen_count: 0, passed: true, spatial_vmaf: null, spatial_ok: null };
const ev = (o: Partial<VariantEvent>): VariantEvent =>
  ({ source_id: "s1", index: 1, state: "rendering", attempt: 0, max_attempts: 0, status: null, quality: null, filename: null, ...o });

describe("progress reducer", () => {
  const base = () => initRun([{ source_id: "s1", filename: "a.mp4", requested: 2 }]);

  it("seeds sources with requested and zero counts", () => {
    const r = base();
    expect(r.bySource.s1.requested).toBe(2);
    expect(r.bySource.s1.delivered).toBe(0);
    expect(r.complete).toBe(false);
  });

  it("rendering/checking set inFlight", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "rendering", index: 1 }));
    expect(r.bySource.s1.inFlight).toEqual({ index: 1, state: "rendering", attempt: 0, max_attempts: 0 });
    expect(r.bySource.s1.inFlights[1]).toEqual({ index: 1, state: "rendering", attempt: 0, max_attempts: 0 });
    r = reduceEvent(r, ev({ state: "checking", index: 1 }));
    expect(r.bySource.s1.inFlight?.state).toBe("checking");
    expect(r.bySource.s1.inFlights[1]?.state).toBe("checking");
  });

  it("keeps every live copy in inFlights when Fast encodes in parallel", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "rendering", index: 1 }));
    r = reduceEvent(r, ev({ state: "rendering", index: 2 }));
    expect(Object.keys(r.bySource.s1.inFlights)).toHaveLength(2);
    expect(r.bySource.s1.inFlights[1]?.state).toBe("rendering");
    expect(r.bySource.s1.inFlights[2]?.state).toBe("rendering");
    r = reduceEvent(r, ev({ state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4" }));
    expect(r.bySource.s1.inFlights[1]).toBeUndefined();
    expect(r.bySource.s1.inFlights[2]?.state).toBe("rendering");
    expect(r.bySource.s1.inFlight?.index).toBe(2);
  });

  it("rerolling carries attempt/max", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "rerolling", index: 1, attempt: 2, max_attempts: 3 }));
    expect(r.bySource.s1.inFlight).toEqual({ index: 1, state: "rerolling", attempt: 2, max_attempts: 3 });
  });

  it("tracks uniqueness inFlight", () => {
    let r = initRun([{ source_id: "s", filename: "a.mp4", requested: 1 }]);
    r = reduceEvent(r, { source_id: "s", index: 1, state: "uniqueness", attempt: 0, max_attempts: 0, status: null, quality: null, filename: null });
    expect(r.bySource.s.inFlight?.state).toBe("uniqueness");
  });

  it("tracks escalating inFlight", () => {
    let r = initRun([{ source_id: "s", filename: "a.mp4", requested: 1 }]);
    r = reduceEvent(r, { source_id: "s", index: 1, state: "escalating", attempt: 1, max_attempts: 2, status: null, quality: null, filename: null });
    expect(r.bySource.s.inFlight).toEqual({ index: 1, state: "escalating", attempt: 1, max_attempts: 2 });
  });

  it("done(ok) appends a tile, bumps delivered+done, builds file_url, clears inFlight", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "rendering", index: 1 }));
    r = reduceEvent(r, ev({ state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4" }));
    const s = r.bySource.s1;
    expect(s.delivered).toBe(1);
    expect(s.done).toBe(1);
    expect(s.inFlight).toBeUndefined();
    expect(s.inFlights).toEqual({});
    expect(s.variants[0]).toMatchObject({ index: 1, filename: "v01.mp4", status: "ok", file_url: "/api/variants/s1/v01.mp4" });
  });

  it("done(uniqueness_fail) bumps done but not delivered", () => {
    let r = base();
    r = reduceEvent(r, ev({
      state: "done", index: 2, status: "uniqueness_fail",
      uniqueness: 12 / 64, uniqueness_status: "below_floor",
      quality: q, filename: "v02.mp4",
    }));
    expect(r.bySource.s1.done).toBe(1);
    expect(r.bySource.s1.delivered).toBe(0);
    expect(r.bySource.s1.variants[0].status).toBe("uniqueness_fail");
  });

  it("done(best_effort) bumps done and delivered", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "done", index: 2, status: "best_effort", quality: { ...q, passed: false }, filename: "v02.mp4" }));
    expect(r.bySource.s1.done).toBe(1);
    expect(r.bySource.s1.delivered).toBe(1);
    expect(r.bySource.s1.variants[0].file_url).toMatch(/v02/);
  });

  it("is idempotent on replayed done events (reconnect replays the full log)", () => {
    let r = base();
    const d = ev({ state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4" });
    r = reduceEvent(r, d);
    r = reduceEvent(r, d); // replayed after an EventSource reconnect
    expect(r.bySource.s1.done).toBe(1);
    expect(r.bySource.s1.delivered).toBe(1);
    expect(r.bySource.s1.variants).toHaveLength(1);
  });

    it("looking sets inFlight and lookPreview stills", () => {
    let r = base();
    r = reduceEvent(r, ev({
      state: "looking", index: 1,
      look_src: "look_v01_src.jpg", look_var: "look_v01.jpg",
      look_status: "ok", look_mae: 12.4,
    }));
    expect(r.bySource.s1.inFlight?.state).toBe("looking");
    expect(r.bySource.s1.lookPreview).toEqual({
      index: 1,
      src: "/api/look/s1/look_v01_src.jpg",
      var: "/api/look/s1/look_v01.jpg",
      status: "ok",
      mae: 12.4,
    });
  });

  it("uniqueness keeps lookPreview stills on the card", () => {
    let r = base();
    r = reduceEvent(r, ev({
      state: "looking", index: 1,
      look_src: "look_v01_src.jpg", look_var: "look_v01.jpg",
      look_status: "ok", look_mae: 12.4,
    }));
    r = reduceEvent(r, ev({ state: "uniqueness", index: 1 }));
    expect(r.bySource.s1.inFlight?.state).toBe("uniqueness");
    expect(r.bySource.s1.lookPreview?.src).toBe("/api/look/s1/look_v01_src.jpg");
    expect(r.bySource.s1.lookPreview?.var).toBe("/api/look/s1/look_v01.jpg");
  });

  it("done(ok) carries uniqueness onto the tile", () => {
    let r = base();
    r = reduceEvent(r, ev({
      state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4",
      uniqueness: 0.42, uniqueness_status: "ok", uniqueness_target: 0.375, escalated: true,
    }));
    expect(r.bySource.s1.variants[0]).toMatchObject({
      uniqueness: 0.42, uniqueness_status: "ok", uniqueness_target: 0.375, escalated: true,
    });
  });

  it("done(ok) carries look stills onto the tile", () => {
    let r = base();
    r = reduceEvent(r, ev({
      state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4",
      look_status: "fail", look_mae: 51, look_src: "look_v01_src.jpg", look_var: "look_v01.jpg",
    }));
    expect(r.bySource.s1.variants[0]).toMatchObject({
      look_status: "fail",
      look_mae: 51,
      look_src_url: "/api/look/s1/look_v01_src.jpg",
      look_var_url: "/api/look/s1/look_v01.jpg",
    });
  });

  it("job-done marks complete and drops live slots", () => {
    let r = base();
    r = reduceEvent(r, ev({ state: "rendering", index: 1 }));
    r = reduceEvent(r, ev({ state: "rendering", index: 2 }));
    r = reduceEvent(r, { state: "job-done" });
    expect(r.complete).toBe(true);
    expect(r.bySource.s1.inFlight).toBeUndefined();
    expect(r.bySource.s1.inFlights).toEqual({});
  });

  it("is immutable (returns a new object)", () => {
    const r0 = base();
    const r1 = reduceEvent(r0, ev({ state: "rendering", index: 1 }));
    expect(r1).not.toBe(r0);
    expect(r0.bySource.s1.inFlight).toBeUndefined();
  });

  it("runDeliveredNone is true when complete with zero ok variants", () => {
    let r = base();
    r = reduceEvent(r, { state: "job-done" });
    expect(runDeliveredNone(r)).toBe(true);
    r = reduceEvent(base(), ev({
      state: "done", index: 1, status: "ok", quality: q, filename: "v01.mp4",
    }));
    r = reduceEvent(r, { state: "job-done" });
    expect(runDeliveredNone(r)).toBe(false);
  });

  it("runHasStarted is false until a copy is encoding or delivered", () => {
    const idle = base();
    expect(runHasStarted(idle)).toBe(false);
    expect(runHasStarted(reduceEvent(idle, ev({ state: "rendering", index: 1 })))).toBe(true);
  });
});
