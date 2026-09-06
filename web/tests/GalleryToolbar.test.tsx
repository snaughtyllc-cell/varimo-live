import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryToolbar } from "@/components/gallery/GalleryToolbar";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const toolbarProps = {
  count: 0,
  variantCount: 0,
  filterMode: "all" as const,
  onFilter: () => undefined,
  sort: "newest" as const,
  onSort: () => undefined,
  selectedCount: 0,
  sendDisabledReason: "none selected",
  onSend: () => undefined,
  selectAllLabel: "Select all",
  onSelectAll: () => undefined,
  saveLabel: "Save to phone",
  saveDisabledReason: "Select clips first",
  onSave: () => undefined,
};

describe("GalleryToolbar drops chips", () => {
  it("links Sent to Drive and Flagged this week into the drops board", () => {
    render(<GalleryToolbar {...toolbarProps} />);
    expect(screen.getByRole("link", { name: "Sent to Drive" })).toHaveAttribute("href", "/drops");
    expect(screen.getByRole("link", { name: "Flagged this week" })).toHaveAttribute(
      "href",
      "/drops?filter=flagged_week",
    );
  });
});

describe("GalleryToolbar review chrome", () => {
  it("swaps grid actions for Back to grid when a variant is open", () => {
    render(
      <GalleryToolbar
        {...toolbarProps}
        crumb="boil.mp4"
        review={{
          variantLabel: "v03",
          onBack: () => undefined,
          onPrev: () => undefined,
          onNext: () => undefined,
          canPrev: false,
          canNext: true,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /back to grid/i })).toBeInTheDocument();
    expect(screen.getByText("v03")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select all/i })).not.toBeInTheDocument();
  });
});

describe("GalleryToolbar select and save", () => {
  it("shows Select all and a disabled Save to phone until clips are selected", () => {
    render(<GalleryToolbar {...toolbarProps} />);
    expect(screen.getByRole("button", { name: /select all/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /select all \( /i })).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: /save to phone/i });
    expect(save).toBeDisabled();
    expect(screen.getByText("Select clips first")).toBeInTheDocument();
  });

  it("enables Save to Photos for a selection", () => {
    const onSave = vi.fn();
    render(
      <GalleryToolbar
        {...toolbarProps}
        selectedCount={3}
        sendDisabledReason={null}
        saveLabel="Save to Photos"
        saveDisabledReason={null}
        saveHint="Opens the share sheet. Tap Save Video to put the clip in Photos — not Files."
        onSave={onSave}
      />,
    );
    const save = screen.getByRole("button", { name: /save to photos/i });
    expect(save).toBeEnabled();
    save.click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /send to drive \(3\)/i })).toBeInTheDocument();
  });
});
