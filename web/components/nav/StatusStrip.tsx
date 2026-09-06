"use client";
import useSWR from "swr";
import { getHealth } from "../../lib/api";
import { useQueue } from "../../lib/useQueue";
import { queueStripLabel } from "../../lib/queue";

export function StatusStrip() {
  const { data, error } = useSWR("/api/health", () => getHealth(), {
    refreshInterval: 10000,
    revalidateOnFocus: false,
  });
  const { data: queue } = useQueue();
  const queueLabel = queueStripLabel(queue);

  const online = !error && data?.status === "ok";
  const ready = data !== undefined && !error;
  const loading = data === undefined && !error;

  return (
    <div className="flex items-center gap-2.5 text-[11.5px] text-muted">
      {/* Engine status pill */}
      <span
        className="status-engine inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line"
        aria-label={loading ? "Checking" : ready && online ? "Ready" : "Offline"}
      >
        <span
          className="status-engine__dot w-[7px] h-[7px] rounded-full flex-none"
          aria-hidden="true"
          style={
            ready && online
              ? { background: "#22c55e", boxShadow: "0 0 8px #22c55e88" }
              : loading
              ? { background: "#87989d" }
              : { background: "#f87171", boxShadow: "0 0 8px #f8717188" }
          }
        />
        {loading ? <span className="status-ready-text">…</span> : ready && online ? <span className="status-ready-text">Ready</span> : <span className="status-ready-text">Offline</span>}
      </span>

      {queueLabel && (
        <span
          className="status-queue inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line"
          title="Live packs on this shared Studio URL"
        >
          {queueLabel}
        </span>
      )}

      {/* Local mode pill — desktop only; phones hide it to keep the bar usable */}
      <span
        className="status-cpu inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line"
      >
        Local&nbsp;·&nbsp;CPU&nbsp;<strong className="text-text font-semibold">fast</strong>
      </span>
    </div>
  );
}
