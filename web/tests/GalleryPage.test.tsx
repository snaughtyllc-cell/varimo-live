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
  getSourceDownloads: vi.fn(async () => ({ source_id: "s1", files: [], zip_url: null })),
  regenerate: vi.fn(),
  retryCopy: vi.fn(),
  removeSource: vi.fn(),
  setPlatformResult: vi.fn().mockResolvedValue({}),
  setPostUrl: vi.fn().mockResolvedValue({}),
  approveLookEncode: vi.fn().mockResolvedValue({}),
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

  it("opens the review pane in the grid so packs stay on screen", () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    render(<GalleryContent />);
    fireEvent.click(screen.getByText("v03"));
    expect(pushState).toHaveBeenCalledWith(null, "", "/gallery?v=6bc8f627184a:3");
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /variant review/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to grid/i })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /packs/i })).toBeInTheDocument();
    expect(screen.getAllByText(/v03/).length).toBeGreaterThan(0);
    expect(screen.getByText(/DRAG THE DIVIDER TO WIPE/i)).toBeInTheDocument();
    pushState.mockRestore();
  });

  it("puts pack Insights directly under the pack tiles", () => {
    render(<GalleryContent />);
    const packs = screen.getByRole("complementary", { name: /packs/i });
    const strip = screen.getByRole("region", { name: /pack insights/i });
    expect(packs.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/sample insights/i)).toBeInTheDocument();
    expect(strip.parentElement).toHaveClass("gallery-main");
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

  it("shows the floating toolbar only once a clip is selected", () => {
    render(<GalleryContent />);
    expect(screen.queryByRole("toolbar", { name: /selected variants/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/select v03/i));

    const floating = screen.getByRole("toolbar", { name: /selected variants/i });
    expect(within(floating).getByText("1 variant selected")).toBeInTheDocument();
  });
});
