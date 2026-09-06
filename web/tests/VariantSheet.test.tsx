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
  approveLookEncode: vi.fn().mockResolvedValue({}),
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

describe("VariantSheet embedded review", () => {
  it("renders in the pane without a dialog overlay", () => {
    render(
      <VariantSheet
        embedded
        sourceId="s1"
        sourceName="boil"
        variants={[variant()]}
        index={0}
        onClose={() => {}}
        onNav={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /variant review/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/go to variant 03/i)).toBeInTheDocument();
    expect(screen.getByText(/DRAG THE DIVIDER TO WIPE/i)).toBeInTheDocument();
    expect(screen.getAllByText(/v03/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/of 1/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

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

  it("shows a review trigger for MAE over 38, not a looks-bad verdict", async () => {
    render(
      <VariantSheet
        sourceId="s1"
        sourceName="boil"
        variants={[
          variant({
            look_status: "review_required",
            look_mae: 44,
            look_mae_max: 51,
            look_review_t: 2,
            look_frames: [
              { frac: 0.25, t_var: 1, mae: 12 },
              { frac: 0.5, t_var: 2, mae: 51 },
              { frac: 0.75, t_var: 3, mae: 20 },
            ],
            quality: {
              vmaf: 98,
              histogram_ok: true,
              regen_count: 0,
              passed: true,
              spatial_vmaf: null,
              spatial_ok: true,
              vmaf_scope: "proxy_encode_quality",
              look_crop: { crop_keep: 0.86, crop_x_frac: 0.5, crop_y_frac: 0.2 },
            },
          }),
        ]}
        index={0}
        onClose={() => {}}
        onNav={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByText("Review this encode")).toBeInTheDocument();
    expect(screen.getByText(/not a verdict that it looks bad/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play flagged moment/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve this encode/i })).toBeInTheDocument();
    expect(screen.queryByText("Look fail")).not.toBeInTheDocument();
    expect(screen.getByText(uniquenessCustomerLabel())).toBeInTheDocument();
  });
});

describe("variant sheet CSS contract", () => {
  it("keeps flex + overflow on the sheet classes so a theme restyle cannot drop scroll", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.variant-sheet__header\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.variant-sheet__body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.variant-sheet\s*\{[^}]*overflow:\s*hidden/s);
  });

  it("grows review filmstrip tiles and lets the wipe player fill the stage", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.gallery-review \.variant-sheet__filmstrip-tile\s*\{[^}]*width:\s*80px/s);
    expect(css).toMatch(/\.gallery-review \.variant-sheet__filmstrip-tile\s*\{[^}]*height:\s*142px/s);
    expect(css).toMatch(/\.gallery-review \.compare-slider--stage\s*\{[^}]*100cqh/s);
  });
});
