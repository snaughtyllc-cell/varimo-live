"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreateJobResponse } from "@/lib/types";
import { useRun } from "@/lib/runStore";

type Preview = {
  target: { model: string; page: string; winner: string; source_file_id: string };
  source_name: string;
  folder_id: string;
  job_id?: string;
  state?: string;
  exported?: number;
};

export function HqTargetReview() {
  const [id, setId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(20);
  const { start, jobId, complete } = useRun();
  const refresh = useCallback(async (handoff: string) => {
    const res = await fetch(`/api/hq/targets/${handoff}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Could not load the HQ request");
    setPreview(body);
  }, []);

  useEffect(() => {
    const handoff = new URLSearchParams(window.location.search).get("handoff");
    if (!handoff || !/^[a-f0-9]{64}$/.test(handoff)) return;
    // The fragment was already verified and removed by the sign-in page.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only query
    setId(handoff);
    refresh(handoff).catch((e: Error) => setError(e.message));
  }, [refresh]);

  useEffect(() => {
    if (id && complete) refresh(id).catch((e: Error) => setError(e.message));
  }, [id, complete, refresh]);

  async function submit(action: "generate" | "export") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/hq/targets/${id}/${action}?count=${count}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Request did not complete");
      if (action === "generate") start(body as CreateJobResponse, "fast");
      await refresh(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request did not complete");
    } finally { setBusy(false); }
  }

  if (!id) return null;
  return <section aria-label="HQ winner request" className="studio-option-row--static">
    <h2>Send winner variations to Postdesk</h2>
    {error && <p role="alert">{error}</p>}
    {!preview ? <p>Loading the HQ request…</p> : <>
      <p>{preview.source_name}</p>
      <p>{preview.target.model} / {preview.target.page} / To Post / Winners / {preview.target.winner}</p>
      <p>Generated videos will go directly into this winner folder, where Postdesk can pick them up.</p>
      <a href={`https://drive.google.com/drive/folders/${encodeURIComponent(preview.folder_id)}`} target="_blank" rel="noreferrer">Open destination</a>
      {!preview.job_id ? <>
        <label>Variations <input aria-label="Winner variations" type="number" min={1} max={40} value={count} onChange={e => setCount(Number(e.target.value))} /></label>
        <button disabled={busy || !!(jobId && !complete) || count < 1 || count > 40 || !Number.isInteger(count)} onClick={() => void submit("generate")}>Generate and send to Postdesk</button>
      </> : <>
        <p>Job {preview.job_id}: {preview.state ?? "running"}. {preview.exported ?? 0} files delivered.</p>
        {preview.state === "done" && <button disabled={busy} onClick={() => void submit("export")}>Check or resume delivery</button>}
      </>}
    </>}
  </section>;
}
