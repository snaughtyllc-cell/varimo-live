import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariantStepper } from "@/components/studio/VariantStepper";

describe("VariantStepper", () => {
  it("shows the count and steppers with no GPU or add-clips hint", () => {
    render(<VariantStepper value={8} onChange={vi.fn()} fileCount={0} />);
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByLabelText("Decrease variants")).toBeInTheDocument();
    expect(screen.getByLabelText("Increase variants")).toBeInTheDocument();
    expect(screen.queryByText(/gpu/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/add clips/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/per video/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/usual pack/i)).not.toBeInTheDocument();
  });
});
