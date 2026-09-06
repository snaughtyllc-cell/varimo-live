"use client";
import { useEffect, useState } from "react";

/** Tick once a second while `active` so a long Fast cold start is visibly moving. */
export function useElapsedSeconds(active: boolean, startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startedAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  if (!active || startedAt == null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
