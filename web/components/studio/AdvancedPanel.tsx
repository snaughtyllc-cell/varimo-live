"use client";
import { useState } from "react";
import { HQ_BATCH_WARN_AT, hqBatchHint } from "@/lib/hqThroughputCopy";

interface AdvancedPanelProps {
  allowCreativeEscalate: boolean;
  onAllowCreativeEscalateChange: (value: boolean) => void;
  qualityMode: "fast" | "hq";
  onQualityModeChange: (value: "fast" | "hq") => void;
  totalVariants?: number;
}

export function AdvancedPanel({
  allowCreativeEscalate,
  onAllowCreativeEscalateChange,
  qualityMode,
  onQualityModeChange,
  totalVariants = 0,
}: AdvancedPanelProps) {
  const [open, setOpen] = useState(false);
  const hqHint = hqBatchHint(qualityMode, totalVariants);

  return (
    <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
      <div
        className="studio-option-row studio-option-row--static studio-option-row--last"
        style={{ userSelect: "none", cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="studio-option-row__label">Advanced</span>
        <span className="studio-option-row__value">
          Output: Matches source
          <span
            className="material-symbols-rounded studio-option-row__chevron"
            data-open={open || undefined}
          >
            chevron_right
          </span>
        </span>
      </div>
      {open && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "var(--color-panel2)",
            borderRadius: 8,
            border: "1px solid var(--color-line)",
            fontSize: 12,
            color: "var(--color-muted)",
          }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Output format</span>
              <span style={{ color: "var(--color-text)", fontWeight: 600 }}>Matches source</span>
            </div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 11,
                lineHeight: 1.45,
                color: "var(--color-muted2)",
              }}
            >
              Auto — 9:16 → 1080×1920, 16:9 → 1920×1080.
            </p>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
            <span>
              Quality
              <span
                style={{
                  display: "block",
                  fontSize: 10.5,
                  color: "var(--color-muted2)",
                  marginTop: 2,
                  lineHeight: 1.4,
                }}
              >
                Fast is the usual pack. HQ as a 20-pack is off.
                Reconstruct first is the Options switch above.
              </span>
            </span>
            <select
              value="fast"
              onChange={() => onQualityModeChange("fast")}
              style={{
                marginLeft: 12,
                flexShrink: 0,
                background: "var(--color-panel)",
                color: "var(--color-text)",
                border: "1px solid var(--color-line)",
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 12,
              }}
            >
              <option value="fast">Fast</option>
              <option value="hq" disabled>
                HQ — not a 20-pack
              </option>
            </select>
          </div>

          {hqHint && qualityMode === "hq" && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 11,
                lineHeight: 1.45,
                color: totalVariants >= HQ_BATCH_WARN_AT ? "var(--color-amber)" : "var(--color-muted2)",
              }}
            >
              {hqHint}
            </p>
          )}

          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span>
              Allow creative escalate
              <span
                style={{
                  display: "block",
                  fontSize: 10.5,
                  color: "var(--color-muted2)",
                  marginTop: 2,
                  lineHeight: 1.4,
                }}
              >
                Optimized for uniqueness while keeping a clean look. Even one
                file is scored vs the original. Pass is 38%. If medium misses
                38%, one strong pass always runs. Only after that hunt: 30%
                and up still ships. Under 30% is a uniqueness miss — not a
                Drive file.
              </span>
            </span>
            <input
              type="checkbox"
              checked={allowCreativeEscalate}
              onChange={(e) => onAllowCreativeEscalateChange(e.target.checked)}
              style={{ width: 16, height: 16, flexShrink: 0, marginLeft: 12, accentColor: "var(--color-violet)" }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
