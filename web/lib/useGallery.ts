"use client";
import { useEffect, useRef } from "react";
import useSWR from "swr";
import { getGallery, retryCopy } from "./api";
import { galleryRefreshMs, missingCopySourceIds } from "./gallery";
import { SourceOut } from "./types";

export function useGallery() {
  const triedCopy = useRef(new Set<string>());
  const { data, mutate, isLoading } = useSWR<SourceOut[]>(
    "/api/gallery",
    getGallery,
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => galleryRefreshMs(latest),
    },
  );

  useEffect(() => {
    const ids = missingCopySourceIds(data, triedCopy.current);
    if (ids.length === 0) return;
    for (const id of ids) triedCopy.current.add(id);
    void Promise.all(ids.map((id) => retryCopy(id).catch(() => null))).then(() => {
      void mutate();
    });
  }, [data, mutate]);

  return { data, mutate, isLoading };
}
