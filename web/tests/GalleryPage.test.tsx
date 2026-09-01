import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceOut, VariantOut } from "@/lib/types";

const routerPush = vi.fn();
const routerReplace = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/useGallery", () => ({
  useGallery: () => ({ data: [source()], mutate: vi.fn(), isLoading: false }),
}));

vi.mock("@/lib/runStore", () => ({
  useRun: () => ({ complete: false }),
}));

vi.mock("@/lib/api", () => ({
  getDriveStatus: () => Promise.resolve({ status: "not_configured", sa_email: null, message: "" }),
  listDestinations: () => Promise.resolve([]),
  sourceUrl: (id: string) => `/api/sources/${id}/source`,
  sourceZipUrl: () => "/api/sources/s1/zip",
  regenerate: vi.fn(),
  retryCopy: vi.fn(),
  removeSource: vi.fn(),
  setPlatformResult: vi.fn().mockResolvedValue({}),
  setPostUrl: vi.fn().mockResolvedValue({}),
  setVariantCaption: vi.fn().mockResolvedValue({}),
}));

import { GalleryContent } from "@/app/gallery/page";

function variant(over: Partial<VariantOut> = {}): VariantOut {
  return {
    index: 3,
    filename: "boil_v03.mp4",
    status: "ok",
    quality: {
      vmaf: 95,
      histogram_ok: true,
      regen_count: 0,
      passed: true,
      spatial_vmaf: null,
      spatial_ok: true,
    },
    file_url: "/api/variants/s1/boil_v03.mp4",
    file_ready: true,
    look_src_url: "/api/look/s1/look_v03_src.jpg",
    look_var_url: "/api/look/s1/look_v03.jpg",
    ...over,
  };
}

function source(over: Partial<SourceOut> = {}): SourceOut {
  return {
    source_id: "6bc8f627184a",
    filename: "if you didnt know a good boil.mp4",
    requested: 1,
    delivered: 1,
    shortfall: 0,
    files_ready: 1,
    job_state: "done",
    copy_status: "ok",
    variants: [variant()],
    ...over,
  };
}

describe("Gallery variant sheet open", () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerReplace.mockReset();
    searchParams.delete("v");
  });

  it("opens the sheet with history.pushState so Gallery does not remount", () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    render(<GalleryContent />);
    fireEvent.click(screen.getByText("v03"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/gallery?v=6bc8f627184a:3");
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pushState.mockRestore();
  });

  it("offers Select all and Save to phone without a variant count on Select all", () => {
    render(<GalleryContent />);
    const toolbar = screen.getByRole("region", { name: /gallery controls/i });
    expect(within(toolbar).getByRole("button", { name: "Select all" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /save to phone/i })).toBeDisabled();
    expect(within(toolbar).getByText("Select clips first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select all \(/i })).not.toBeInTheDocument();
  });

  it("enables Save to phone after a clip is selected", () => {
    render(<GalleryContent />);
    const toolbar = screen.getByRole("region", { name: /gallery controls/i });
    fireEvent.click(screen.getByLabelText(/select v03/i));
    expect(within(toolbar).getByRole("button", { name: /save to phone/i })).toBeEnabled();
    expect(within(toolbar).queryByText("Select clips first")).not.toBeInTheDocument();
  });
});
