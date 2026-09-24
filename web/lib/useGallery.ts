"use client";
import useSWR from "swr";
import { getGallery } from "./api";
import { galleryRefreshMs } from "./gallery";
import { SourceOut } from "./types";

export function useGallery() {
  const { data, mutate, isLoading } = useSWR<SourceOut[]>(
    "/api/gallery",
    getGallery,
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => galleryRefreshMs(latest),
    },
  );
  return { data, mutate, isLoading };
}
