import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceOut } from "@/lib/types";
import { PackList } from "@/components/gallery/PackList";

function pack(over: Partial<SourceOut> & Pick<SourceOut, "source_id" | "filename">): SourceOut {
  return {
    requested: 1,
    delivered: 1,
    shortfall: 0,
    variants: [],
    ...over,
  };
}

describe("PackList", () => {
  it("renders one row per pack and fires onSelect with the clicked pack's source_id", () => {
    const packs = [
      pack({ source_id: "s1", filename: "clip_one.mp4" }),
      pack({ source_id: "s2", filename: "clip_two.mp4" }),
      pack({ source_id: "s3", filename: "clip_three.mp4" }),
    ];
    const onSelect = vi.fn();
    render(
      <PackList
        packs={packs}
        totalCount={packs.length}
        activeId={undefined}
        onSelect={onSelect}
        search=""
        onSearchChange={() => undefined}
        loading={false}
      />,
    );

    // One row per pack.
    expect(screen.getByText("clip_one.mp4")).toBeInTheDocument();
    expect(screen.getByText("clip_two.mp4")).toBeInTheDocument();
    expect(screen.getByText("clip_three.mp4")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /clip_.*\.mp4/ })).toHaveLength(3);

    fireEvent.click(screen.getByText("clip_two.mp4"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("marks the active pack and filters rows by the search term", () => {
    const packs = [
      pack({ source_id: "s1", filename: "boil_reel.mp4" }),
      pack({ source_id: "s2", filename: "sauce_test.mp4" }),
    ];
    render(
      <PackList
        packs={packs}
        totalCount={packs.length}
        activeId="s2"
        onSelect={() => undefined}
        search="sauce"
        onSearchChange={() => undefined}
        loading={false}
      />,
    );

    expect(screen.queryByText("boil_reel.mp4")).not.toBeInTheDocument();
    const row = screen.getByText("sauce_test.mp4").closest("button");
    expect(row).toHaveAttribute("data-active", "true");
  });

  it("shows an empty state instead of rows when there are no packs", () => {
    render(
      <PackList
        packs={[]}
        totalCount={0}
        activeId={undefined}
        onSelect={() => undefined}
        search=""
        onSearchChange={() => undefined}
        loading={false}
      />,
    );
    expect(screen.getByText("No packs yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
