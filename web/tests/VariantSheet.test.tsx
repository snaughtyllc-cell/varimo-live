import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VariantOut } from "@/lib/types";
import { captionEmptyCopy, captionPreviewLabel, uniquenessCustomerLabel } from "@/lib/prepareCopy";
import { VariantSheet } from "@/components/variant/VariantSheet";

vi.mock("@/lib/api", () => ({
  sourceUrl: (id: string) => `/api/sources/${id}/source`,
  regenerate: vi.fn(),
  setPlatformResult: vi.fn().mockResolvedValue({}),
  setPostUrl: vi.fn().mockResolvedValue({}),
  setVariantCaption: vi.fn().mockResolvedValue({}),
}));

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
    look_src_url: "/api/look/s1/look_v03_src.jpg",
    look_var_url: "/api/look/s1/look_v03.jpg",
    look_status: "ok",
    look_mae: 12,
    ...over,
  };
}

describe("VariantSheet layout", () => {
  it("keeps header as a row and the body as the scroll container", () => {
    render(
      <VariantSheet
        sourceId="s1"
        sourceName="boil"
        variants={[variant({ index: 1 }), variant({ index: 2 }), variant()]}
        index={2}
        onClose={() => {}}
        onNav={() => {}}
        onRegenerate={() => {}}
      />,
    );
    const header = document.querySelector(".variant-sheet__header") as HTMLElement;
    const body = document.querySelector(".variant-sheet__body") as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.display).toBe("flex");
    expect(body.style.overflowY).toBe("auto");
    expect(["0", "0px"]).toContain(body.style.minHeight);
    expect(screen.getByRole("button", { name: "Previous variant" }).parentElement).toBe(header);
    expect(screen.getByRole("button", { name: "Next variant" }).parentElement).toBe(header);
    expect(screen.getByRole("button", { name: "Close" }).parentElement).toBe(header);
  });

  it("does not dump giant look stills under the compare slider", () => {
    render(
      <VariantSheet
        sourceId="s1"
        sourceName="boil"
        variants={[variant()]}
        index={0}
        onClose={() => {}}
        onNav={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByAltText("Source still")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Variant still")).not.toBeInTheDocument();
    expect(screen.getByText(captionPreviewLabel())).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: captionPreviewLabel() })).toHaveAttribute(
      "placeholder",
      captionEmptyCopy(),
    );
    expect(screen.getByText(uniquenessCustomerLabel())).toBeInTheDocument();
    expect(screen.queryByText("Look fail")).not.toBeInTheDocument();
    expect(screen.queryByText("VMAF")).not.toBeInTheDocument();
    expect(screen.queryByText("View manifest")).not.toBeInTheDocument();
    expect(screen.queryByText("Passed upload")).not.toBeInTheDocument();
    expect(screen.queryByText("Flagged")).not.toBeInTheDocument();
    expect(screen.queryByText("Look")).not.toBeInTheDocument();
  });
});

describe("variant sheet CSS contract", () => {
  it("keeps flex + overflow on the sheet classes so a theme restyle cannot drop scroll", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.variant-sheet__header\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.variant-sheet__body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.variant-sheet\s*\{[^}]*overflow:\s*hidden/s);
  });
});
