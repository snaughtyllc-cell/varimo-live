import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowToPage } from "@/components/help/HowToPage";
import { HOW_TO_CATEGORIES, HOW_TO_FORBIDDEN } from "@/lib/howTo";

describe("HowToPage", () => {
  it("opens Generating by default and switches categories", () => {
    render(<HowToPage />);
    expect(screen.getByRole("heading", { level: 1, name: "How to" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Generating" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: /start from the original/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /studio → gallery/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /check the look/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute("href", "/studio");
    expect(screen.getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "/gallery");
    expect(screen.queryByRole("heading", { name: /^workflows$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Trial Reels/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Automation" }));
    expect(screen.getByRole("heading", { name: /^workflows$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /drive filenames/i })).toBeInTheDocument();
    expect(screen.getByText(/ordinary unique clip name/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^plugins$/i })).toBeInTheDocument();
    expect(screen.queryByText(/caption bank/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we do not run those seats/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workflows" })).toHaveAttribute("href", "/workflows");
    expect(screen.getByRole("link", { name: "Drive" })).toHaveAttribute("href", "/settings/drive");
    expect(screen.queryByRole("heading", { name: /studio → gallery/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Posting" }));
    expect(screen.getByRole("heading", { name: /trial reels/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /multiple accounts/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Studio" })).not.toBeInTheDocument();
  });

  it("does not publish fingerprint internals on any tab", () => {
    render(<HowToPage />);
    for (const category of HOW_TO_CATEGORIES) {
      fireEvent.click(screen.getByRole("tab", { name: category.label }));
      const shown = document.body.textContent || "";
      for (const pattern of HOW_TO_FORBIDDEN) {
        expect(shown).not.toMatch(pattern);
      }
    }
  });
});
