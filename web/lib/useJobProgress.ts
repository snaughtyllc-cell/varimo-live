"use client";
import { useEffect, useRef, useState } from "react";
import { eventsUrl, getJob } from "./api";
import { initRun, reduceEvent, RunProgress } from "./progress";
import { isPreparingJob } from "./prepareCopy";
import { VariantEvent } from "./types";

function applyJobDetail(run: RunProgress, detail: Awaited<ReturnType<typeof getJob>>): RunProgress {
  let next = run;
  for (const s of detail.sources) {
    for (const v of s.variants) {
      const ev: VariantEvent = {
        source_id: s.source_id,
        index: v.index,
        state: "done",
        attempt: 0,
        max_attempts: 0,
        status: v.status,
        quality: v.quality,
        filename: v.filename,
        uniqueness: v.uniqueness ?? null,
        uniqueness_status: v.uniqueness_status ?? null,
        uniqueness_target: v.uniqueness_target ?? null,
        escalated: v.escalated ?? false,
        platform_result: v.platform_result ?? null,
        look_status: v.look_status ?? null,
        look_mae: v.look_mae ?? null,
        look_src_url: v.look_src_url ?? null,
        look_var_url: v.look_var_url ?? null,
      };
      next = reduceEvent(next, ev);
    }
    // Mid-flight state rides on JobDetail so RunPod-buffered SSE is not required.
    const flights = s.in_flights?.length
      ? s.in_flights
      : s.in_flight
        ? [s.in_flight]
        : [];
    const cleared = next.bySource[s.source_id];
    if (cleared) {
      next = {
        ...next,
        bySource: {
          ...next.bySource,
          [s.source_id]: { ...cleared, inFlight: undefined, inFlights: {} },
        },
      };
    }
    for (const f of flights) {
      next = reduceEvent(next, {
        source_id: s.source_id,
        index: f.index,
        state: f.state,
        attempt: f.attempt,
        max_attempts: f.max_attempts,
        status: null,
        quality: null,
        filename: null,
      });
    }
    if (s.look_preview) {
      const prev = next.bySource[s.source_id];
      if (prev) {
        next = {
          ...next,
          bySource: {
            ...next.bySource,
            [s.source_id]: {
              ...prev,
              lookPreview: {
                index: s.look_preview.index,
                src: s.look_preview.look_src_url || "",
                var: s.look_preview.look_var_url || "",
                status: s.look_preview.look_status ?? null,
                mae: s.look_preview.look_mae ?? null,
              },
            },
          },
        };
      }
    }
  }
  if (detail.state === "done" || detail.state === "cancelled" || detail.state === "completed" || detail.state === "failed") {
    const cleared: RunProgress = {
      ...next,
      complete: true,
      failed: detail.error || next.failed || null,
      bySource: Object.fromEntries(
        Object.entries(next.bySource).map(([id, s]) => [id, { ...s, inFlight: undefined, inFlights: {} }]),
      ),
    };
    next = reduceEvent(cleared, { state: "job-done" });
  }
  next = { ...next, waitPhase: detail.wait_phase ?? null };
  return next;
}

export function useJobProgress(
  jobId: string | null,
  sources: { source_id: string; filename: string; requested: number }[],
): RunProgress {
  const [run, setRun] = useState<RunProgress>(() => initRun(sources));
  const runRef = useRef(run);
  runRef.current = run;
  const sourcesKey = sources.map((s) => s.source_id).join(",");
  const preparing = isPreparingJob(jobId);
  useEffect(() => {
    if (!jobId || sources.length === 0) return;
    const fresh = initRun(sources);
    runRef.current = fresh;
    setRun(fresh);
    if (isPreparingJob(jobId)) return;

    // SSE still helps locally; RunPod's HTTP proxy often buffers it forever.
    const es = new EventSource(eventsUrl(jobId));
    es.onmessage = (e) => {
      let ev: ReturnType<typeof JSON.parse>;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      const next = reduceEvent(runRef.current, ev);
      runRef.current = next;
      setRun(next);
      if (ev.state === "job-done") es.close();
    };

    let cancelled = false;
    const poll = async () => {
      try {
        const detail = await getJob(jobId);
        if (cancelled) return;
        const next = applyJobDetail(runRef.current, detail);
        runRef.current = next;
        setRun(next);
        if (detail.state === "done" || detail.state === "cancelled" || detail.state === "completed" || detail.state === "failed") es.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.startsWith("404")) {
          const next: RunProgress = {
            ...runRef.current,
            complete: true,
            failed: "This run is gone (Studio restarted or the job never saved). Generate again.",
          };
          runRef.current = next;
          setRun(next);
          es.close();
        }
      }
    };
    poll();
    const pollId = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sourcesKey]);
  if (preparing) return initRun(sources);
  return run;
}
