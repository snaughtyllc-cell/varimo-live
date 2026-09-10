"use client";
import useSWR from "swr";
import { getAuthMe } from "./api";
import type { AuthMe } from "./types";

export function useAuthMe() {
  const { data, mutate, isLoading, error } = useSWR<AuthMe>(
    "/api/auth/me",
    getAuthMe,
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => {
        const usage = latest?.usage;
        if (!usage || usage.uncapped) return 0;
        return 4000;
      },
    },
  );
  return { data, mutate, isLoading, error };
}
