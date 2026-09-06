"use client";
import {
  MAX_PER_VIDEO,
  VARIANT_COUNT_PRESETS,
  variantPresetLabel,
} from "@/lib/variantStepperCopy";

interface VariantStepperProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
}

export function VariantStepper({
  value,
  onChange,
  min = 1,
  max = MAX_PER_VIDEO,
}: VariantStepperProps) {
  const presets = VARIANT_COUNT_PRESETS.map((count) => ({
    value: count,
    label: variantPresetLabel(count),
  }));

  function decrement() {
    if (value > min) onChange(value - 1);
  }
  function increment() {
    if (value < max) onChange(value + 1);
  }
  function setPreset(preset: number) {
    onChange(Math.min(max, Math.max(min, preset)));
  }

  return (
    <div className="studio-stepper">
      <div className="studio-stepper__count">
        <div className="studio-stepper__value">{value}</div>
        <div className="studio-stepper__unit">each</div>
      </div>
      <div className="studio-stepper__btns">
        <button
          type="button"
          className="studio-stepper__btn"
          onClick={decrement}
          disabled={value <= min}
          aria-label="Decrease variants"
        >
          <span className="material-symbols-rounded" style={{ fontSize: 19 }}>remove</span>
        </button>
        <button
          type="button"
          className="studio-stepper__btn"
          onClick={increment}
          disabled={value >= max}
          aria-label="Increase variants"
        >
          <span className="material-symbols-rounded" style={{ fontSize: 19 }}>add</span>
        </button>
      </div>
      <div className="studio-stepper__presets">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="studio-stepper__preset"
            data-active={value === preset.value || undefined}
            onClick={() => setPreset(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
