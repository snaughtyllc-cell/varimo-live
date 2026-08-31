"use client";
import { MAX_PER_VIDEO } from "@/lib/variantStepperCopy";

interface VariantStepperProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  fileCount: number;
  qualityMode?: "fast" | "hq";
}

export function VariantStepper({
  value,
  onChange,
  min = 1,
  max = MAX_PER_VIDEO,
}: VariantStepperProps) {
  function decrement() {
    if (value > min) onChange(value - 1);
  }
  function increment() {
    if (value < max) onChange(value + 1);
  }

  const btnStyle: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 8,
    background: "#fbfdfd",
    border: "1px solid var(--color-line)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    color: "var(--color-text)",
    cursor: "pointer",
    userSelect: "none",
    fontWeight: 700,
    lineHeight: 1,
  };

  return (
    <div className="studio-stepper">
      <p className="studio-stepper__label">
        2 · Variants each
      </p>
      <div className="studio-stepper__value-row">
        <div className="studio-stepper__value">{value}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={btnStyle} onClick={decrement} aria-label="Decrease variants">
            –
          </button>
          <button style={btnStyle} onClick={increment} aria-label="Increase variants">
            +
          </button>
        </div>
      </div>
    </div>
  );
}
