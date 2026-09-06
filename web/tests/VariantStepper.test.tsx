import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariantStepper } from "@/components/studio/VariantStepper";
import { VARIANT_COUNT_PRESETS, variantPresetLabel } from "@/lib/variantStepperCopy";

describe("VariantStepper presets", () => {
  it("labels the chips 3, 10, and 20 with no speed-test or usual copy", () => {
    render(<VariantStepper value={20} onChange={vi.fn()} />);
    for (const count of VARIANT_COUNT_PRESETS) {
      expect(screen.getByRole("button", { name: variantPresetLabel(count) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /speed test/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /usual/i })).not.toBeInTheDocument();
    expect(document.querySelector(".studio-stepper")?.textContent).not.toMatch(/speed test|usual/i);
  });

  it("applies a numbered preset", () => {
    const onChange = vi.fn();
    render(<VariantStepper value={20} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
