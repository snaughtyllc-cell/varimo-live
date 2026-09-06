"use client";
import { pct01 } from "@/lib/format";
import type { QualityHead } from "@/lib/types";
import {
  uniquenessCoverageChips,
  uniquenessCoverageSubcopy,
  uniquenessCustomerLabel,
  uniquenessPassHint,
  uniquenessPassPct,
} from "@/lib/prepareCopy";

interface QualityPanelProps {
  uniqueness?: number | null;
  uniquenessStatus?: string | null;
  bestEffort?: boolean;
  packAvgPct?: number | null;
  heads?: Record<string, QualityHead | null | undefined> | null;
}

const PASS_PCT = uniquenessPassPct();

function Meter({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        height: 8,
        borderRadius: 99,
        background: "#e1edee",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(100, Math.max(0, pct))}%`,
          borderRadius: 99,
          background: color,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${PASS_PCT}%`,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--color-text)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}

export function QualityPanel({
  uniqueness,
  uniquenessStatus,
  bestEffort,
  packAvgPct,
  heads,
}: QualityPanelProps) {
  const uniquenessPct = uniqueness != null ? pct01(uniqueness) : null;
  const uniquenessOk = uniquenessStatus === "ok";
  const uniquenessFloorFail = uniquenessStatus === "below_floor";
  const meterColor = uniquenessFloorFail ? "var(--color-red)" : uniquenessOk ? "var(--color-mint)" : "var(--color-amber2)";
  const coverage = uniquenessCoverageChips(uniqueness, heads);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          margin: "0 0 10px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), monospace",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--color-violet)",
          }}
        >
          {uniquenessCustomerLabel()}
        </div>
        {packAvgPct != null && (
          <div
            style={{
              fontFamily: "var(--font-space-grotesk), monospace",
              fontSize: 10.5,
              color: "var(--color-muted2)",
            }}
          >
            pack avg {packAvgPct}%
          </div>
        )}
      </div>

      {bestEffort && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "9px 11px",
            marginBottom: 10,
            fontSize: 11.5,
            lineHeight: 1.5,
            color: "var(--color-amber)",
            background: "#fdf9ef",
            border: "1px solid var(--color-amber2)",
            borderRadius: 8,
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 15 }} aria-hidden="true">warning</span>
          <span>This copy needed extra processing.</span>
        </div>
      )}

      {uniquenessPct != null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: "var(--color-text)",
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {uniquenessPct}%
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <Meter pct={uniquenessPct} color={meterColor} />
            <div
              style={{
                fontFamily: "var(--font-space-grotesk), monospace",
                fontSize: 9.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-muted2)",
              }}
            >
              {uniquenessPassHint()}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                lineHeight: 1.45,
                letterSpacing: 0,
                textTransform: "none",
                color: "var(--color-muted)",
              }}
            >
              {uniquenessCoverageSubcopy()}
            </p>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "11px 12px",
            background: "var(--color-panel2)",
            border: "1px solid var(--color-line)",
            borderRadius: 10,
          }}
        >
          <Meter pct={0} color="var(--color-line2)" />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              flexShrink: 0,
              color: "var(--color-muted)",
            }}
          >
            — / n/a
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 10,
        }}
      >
        {coverage.map((chip) => {
          const scored = chip.state === "scored";
          return (
            <span
              key={chip.kind}
              title={chip.title}
              data-coverage-chip={chip.kind}
              data-coverage-state={chip.state}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "3px 7px",
                borderRadius: 6,
                lineHeight: 1.4,
                background: scored ? "#e7f7f8" : "transparent",
                color: scored ? "#075966" : "var(--color-muted2)",
                border: `1px solid ${scored ? "#b7e4e8" : "var(--color-line)"}`,
              }}
            >
              {chip.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
