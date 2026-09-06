import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QualityPanel } from "@/components/variant/QualityPanel";
import {
  uniquenessCoverageSubcopy,
  uniquenessCustomerLabel,
  uniquenessPassHint,
} from "@/lib/prepareCopy";

describe("QualityPanel", () => {
  it("shows an Originality meter and hides technical quality rows", () => {
    render(
      <QualityPanel
        uniqueness={0.5}
        uniquenessStatus="ok"
        bestEffort={false}
      />,
    );
    expect(screen.getByText(uniquenessCustomerLabel())).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("Look")).not.toBeInTheDocument();
    expect(screen.queryByText(/Look fail/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MAE/)).not.toBeInTheDocument();
    expect(screen.queryByText("VMAF")).not.toBeInTheDocument();
    expect(screen.queryByText("Spatial guard")).not.toBeInTheDocument();
    expect(screen.queryByText("Histogram")).not.toBeInTheDocument();
    expect(screen.queryByText("Re-rolls")).not.toBeInTheDocument();
    expect(screen.queryByText("Similarity")).not.toBeInTheDocument();
    expect(screen.queryByText("✗ fail")).not.toBeInTheDocument();
    expect(screen.queryByText(/stronger uniqueness pass/i)).not.toBeInTheDocument();
    expect(screen.getByText(uniquenessPassHint())).toBeInTheDocument();
    expect(screen.getByText(uniquenessCoverageSubcopy())).toBeInTheDocument();
    expect(screen.getByText("Pixel · scored")).toBeInTheDocument();
    expect(screen.getByText("Visual copy-id · not scored")).toBeInTheDocument();
    expect(screen.getByText("Audio · not scored")).toBeInTheDocument();
    expect(screen.queryByText(/verified-original/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/65% =/)).not.toBeInTheDocument();
  });

  it("lights visual and audio coverage chips when those heads ran", () => {
    render(
      <QualityPanel
        uniqueness={0.41}
        uniquenessStatus="ok"
        heads={{
          visual: { available: true, uniqueness: 0.22 },
          audio: { available: true, uniqueness: 0.05 },
        }}
      />,
    );
    expect(screen.getByText("Pixel · scored")).toBeInTheDocument();
    expect(screen.getByText("Visual copy-id · 22%")).toBeInTheDocument();
    expect(screen.getByText("Audio · 5%")).toBeInTheDocument();
    expect(screen.queryByText("Visual copy-id · not scored")).not.toBeInTheDocument();
  });

  it("uses mild copy when a copy needed extra processing", () => {
    render(<QualityPanel uniqueness={0.4} uniquenessStatus="ok" bestEffort />);
    expect(screen.getByText("This copy needed extra processing.")).toBeInTheDocument();
    expect(screen.queryByText(/Best effort after 3 re-rolls/i)).not.toBeInTheDocument();
  });
});
