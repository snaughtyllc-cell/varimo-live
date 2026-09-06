import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VariantCard } from "@/components/gallery/VariantCard";
import type { VariantOut } from "@/lib/types";
import { ESCALATED_TITLE } from "@/lib/format";

function variant(over: Partial<VariantOut> & { caption?: string | null } = {}): VariantOut {
  return {
    index: 1,
    filename: "v01.mp4",
    status: "ok",
    quality: {
      vmaf: 95,
      histogram_ok: true,
      regen_count: 0,
      passed: true,
      spatial_vmaf: null,
      spatial_ok: null,
    },
    file_url: "/files/v01.mp4",
    uniqueness: 0.5,
    uniqueness_status: "ok",
    uniqueness_target: 32 / 64,
    escalated: false,
    ...over,
  };
}

describe("VariantCard platform badges", () => {
  it("does not show a pass badge when unlabeled", () => {
    render(
      <VariantCard
        variant={variant({ platform_result: null })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(screen.queryByText("⚠")).not.toBeInTheDocument();
    expect(screen.queryByText("⚑")).not.toBeInTheDocument();
  });

  it("does not show a flagged chip to customers", () => {
    render(
      <VariantCard
        variant={variant({ platform_result: "flagged" })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByTitle("Flagged")).not.toBeInTheDocument();
    expect(screen.queryByText("⚑")).not.toBeInTheDocument();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
  });

  it("keeps a duplicate-reject mark", () => {
    render(
      <VariantCard
        variant={variant({ platform_result: "duplicate_reject" })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("⚠")).toBeInTheDocument();
  });
});

describe("VariantCard uniqueness", () => {
  it("shows uniqueness percent (higher = more different)", () => {
    render(
      <VariantCard
        variant={variant({
          quality: {
            vmaf: 95,
            histogram_ok: true,
            regen_count: 0,
            passed: true,
            spatial_vmaf: 92,
            spatial_ok: true,
          },
        })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("esc")).not.toBeInTheDocument();
    expect(screen.queryByText("95")).not.toBeInTheDocument();
    expect(screen.queryByText(/spatial/i)).not.toBeInTheDocument();
  });

  it("shows an esc badge next to uniqueness when escalated", () => {
    render(
      <VariantCard
        variant={variant({ escalated: true })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
    const esc = screen.getByText("esc");
    expect(esc).toBeInTheDocument();
    expect(esc).toHaveAttribute("title", ESCALATED_TITLE);
  });

  it("uses the red uniqueness badge under the 30% ship floor", () => {
    render(
      <VariantCard
        variant={variant({ uniqueness: 18 / 64, uniqueness_status: "below_floor" })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const badge = screen.getByText("28%");
    expect(badge).toBeInTheDocument();
    expect(badge.style.background).toBe("rgb(61, 18, 16)");
  });

  it("marks a variant that has a pasted live post link", () => {
    render(
      <VariantCard
        variant={variant({ post_url: "https://www.instagram.com/reel/AbC/" })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("link")).toBeInTheDocument();
  });

  it("shows Insights views on a linked copy", () => {
    render(
      <VariantCard
        variant={variant({
          ig_media_id: "m1",
          ig_insights: { views: 312400 },
        })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("312k")).toBeInTheDocument();
  });

  it("shows a caption snippet under the clip when present", () => {
    render(
      <VariantCard
        variant={variant({
          caption: "  If you didnt know a good boil this line is long enough to snip past eighty characters for sure  ",
        })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const preview = screen.getByText(/If you didnt know a good boil/);
    expect(preview).toBeInTheDocument();
    expect(preview.textContent).toMatch(/…$/);
  });
});

describe("VariantCard aspect", () => {
  it("locks a small 9:16 preview frame so the video cannot blow the tile to native size", () => {
    const { container } = render(
      <VariantCard
        variant={variant()}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const frame = container.querySelector(".gallery-tile__frame") as HTMLElement;
    expect(frame).toBeTruthy();
    expect(frame.style.aspectRatio).toBe("9 / 16");
    const tile = container.querySelector(".gallery-tile") as HTMLElement;
    expect(tile).toHaveClass("gallery-tile");
    const thumb = container.querySelector(".gallery-tile__thumb") as HTMLElement;
    expect(thumb).toHaveAttribute("data-fill", "true");
  });

  it("keeps a 9:16 box for variants that are not ready", () => {
    render(
      <VariantCard
        variant={variant({ file_ready: false })}
        sourceId="s1"
        onOpen={() => {}}
        selected={false}
        onToggle={() => {}}
      />,
    );
    const placeholder = screen.getByText("Not ready");
    expect(placeholder.style.aspectRatio).toBe("9 / 16");
    expect(placeholder.className).not.toMatch(/absolute/);
  });
});
