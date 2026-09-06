"use client";
import useSWR from "swr";
import { getHealth } from "@/lib/api";

/** True only on Lab Studio (`VARIANT_LAB`). Live testers stay off. */
export function useLabLane(): boolean {
  const { data } = useSWR("/api/health", () => getHealth(), {
    refreshInterval: 10000,
    revalidateOnFocus: false,
  });
  return Boolean(data?.lab);
}
