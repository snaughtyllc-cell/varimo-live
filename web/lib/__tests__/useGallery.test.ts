import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const getGallery = vi.fn();
const retryCopy = vi.fn();

vi.mock("@/lib/api", () => ({
  getGallery: (...args: unknown[]) => getGallery(...args),
  retryCopy: (...args: unknown[]) => retryCopy(...args),
}));

import { useGallery } from "@/lib/useGallery";

const missingPack = {
  source_id: "virgin",
  filename: "Virgin-copy (7).MOV",
  requested: 10,
  delivered: 10,
  shortfall: 0,
  files_ready: 0,
  copy_status: "missing" as const,
  job_state: "done",
  variants: [],
};

describe("useGallery", () => {
  beforeEach(() => {
    getGallery.mockReset();
    retryCopy.mockReset();
    getGallery.mockResolvedValue([missingPack]);
    retryCopy.mockResolvedValue({ ...missingPack, copy_status: "ok", files_ready: 10 });
  });

  it("retries delivery once when a finished pack is missing its files", async () => {
    renderHook(() => useGallery());
    await waitFor(() => {
      expect(retryCopy).toHaveBeenCalledWith("virgin");
    });
    expect(retryCopy).toHaveBeenCalledTimes(1);
  });
});
