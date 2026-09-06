"use client";
import { InFlight, SourceProgress, VariantTile } from "@/lib/progress";
import { ProgressBar } from "@/components/common/ProgressBar";
import { Badge } from "@/components/common/Badge";
import { PosterThumb } from "@/components/common/PosterThumb";
import {
  QualityMode,
  inFlightSlotLabel,
  inFlightSummaryLine,
  type InFlightVerb,
} from "@/lib/hqWaitCopy";
import { ESCALATED_TITLE } from "@/lib/format";
import { preparingSlotLabel, wakingSlotLabel } from "@/lib/prepareCopy";

interface SourceProgressCardProps {
  source: SourceProgress;
  qualityMode?: QualityMode;
  complete?: boolean;
  preparing?: boolean;
  waking?: boolean;
}

function LiveText({ children, live }: { children: string; live: boolean }) {
  return (
    <span className={live ? "vf-live-shimmer" : undefined} style={{ color: "inherit" }}>
      {children}
    </span>
  );
}

function SlotTile({
  index,
  flight,
  qualityMode,
  preparing,
  waking,
}: {
  index: number;
  flight?: InFlight;
  qualityMode: QualityMode;
  preparing?: boolean;
  waking?: boolean;
}) {
  const state: InFlightVerb = (flight?.state as InFlightVerb | undefined) ?? "waiting";
  const live = !!flight || Boolean(preparing || waking);
  const label =
    !flight && waking
      ? wakingSlotLabel()
      : preparing && !flight
        ? preparingSlotLabel()
        : inFlightSlotLabel(state, qualityMode, flight?.attempt, flight?.max_attempts);
  const idx = String(index).padStart(2, "0");
  return (
    <div
      data-testid={`slot-${index}`}
      data-slot-state={state}
      style={{
        aspectRatio: "9 / 16",
        width: "100%",
        alignSelf: "start",
        borderRadius: 6,
        background: "#14252a",
        border: live ? "1px dashed rgba(126, 224, 230, 0.45)" : "1px dashed var(--color-line2)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: 4,
        boxShadow: live ? "0 0 0 1px rgba(126, 224, 230, 0.18)" : "none",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 800, color: live ? "var(--color-cyan)" : "var(--color-muted2)" }}>
        v{idx}
      </span>
      <span style={{ fontSize: 8, color: live ? "var(--color-cyan)" : "var(--color-muted2)" }}>
        <LiveText live={live}>{label}</LiveText>
      </span>
    </div>
  );
}

function DoneThumb({ variant }: { variant: VariantTile }) {
  const vmaf = variant.quality?.vmaf;
  const vmafRounded = vmaf != null ? Math.round(vmaf) : null;
  const badgeColor =
    vmafRounded == null ? "muted" : vmafRounded >= 93 ? "green" : vmafRounded >= 90 ? "amber" : "red";
  const uniquenessPct = variant.uniqueness != null ? Math.round(variant.uniqueness * 100) : null;
  const isBestEffort = variant.status === "best_effort";
  const uniquenessMiss = variant.status === "uniqueness_fail";
  return (
    <PosterThumb
      src={variant.look_var_url}
      badge={
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {vmafRounded != null && (
            <span title="Proxy encode quality">
              <Badge color={badgeColor}>{vmafRounded}</Badge>
            </span>
          )}
          {uniquenessPct != null && (
            <Badge color={uniquenessMiss ? "red" : variant.escalated ? "cyan" : "muted"}>{uniquenessPct}%</Badge>
          )}
          {variant.escalated && (
            <span title={ESCALATED_TITLE}>
              <Badge color="cyan">⚡</Badge>
            </span>
          )}
          {isBestEffort && <Badge color="amber">best effort</Badge>}
          {uniquenessMiss && <Badge color="red">couldn't unique</Badge>}
        </div>
      }
    />
  );
}

export function SourceProgressCard({
  source,
  qualityMode = "fast",
  complete = false,
  preparing = false,
  waking = false,
}: SourceProgressCardProps) {
  const { filename, requested, delivered, done, inFlight, variants } = source;
  const fromMap = source.inFlights || {};
  const inFlights =
    Object.keys(fromMap).length > 0
      ? fromMap
      : inFlight
        ? { [inFlight.index]: inFlight }
        : {};
  const flights = Object.values(inFlights).sort((a, b) => a.index - b.index);
  const progress = requested > 0 ? done / requested : 0;
  const isActive = !complete && (flights.length > 0 || done < requested);
  const summary = complete ? null : inFlightSummaryLine(flights, qualityMode);
  const byIndex = new Map(variants.map((v) => [v.index, v]));
  const slotCount = complete ? 0 : requested;
  const showGrid = variants.length > 0 || isActive;

  return (
    <div
      style={{
        background: "var(--color-panel)",
        border: `1px solid ${isActive ? "var(--color-cyan)" : "var(--color-line)"}`,
        borderRadius: 13,
        padding: 14,
        marginBottom: 13,
        boxShadow: isActive
          ? "0 0 0 1px rgba(126, 224, 230, 0.35), 0 8px 26px rgba(15, 26, 30, 0.35)"
          : "none",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          style={{
            width: 48,
            height: 34,
            borderRadius: 7,
            flex: "none",
            backgroundColor: "#14252a",
            backgroundImage: "repeating-linear-gradient(135deg, rgba(126, 224, 230, 0.12) 0 5px, transparent 5px 10px)",
            border: "1px solid var(--color-line2)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: "var(--color-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
          <span style={{ color: "var(--color-violet-l)" }}>{delivered}</span>
          <span style={{ color: "var(--color-muted)", fontWeight: 600 }}> / {requested}</span>
        </div>
      </div>

      <div style={{ margin: "11px 0 9px" }}>
        <ProgressBar value={progress} />
      </div>

      <div
        style={{
          fontSize: 11.5,
          color: "var(--color-muted)",
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
          minHeight: 16,
        }}
      >
        {summary && (
          <span style={{ color: "var(--color-cyan)" }}>
            <LiveText live>{summary}</LiveText>
          </span>
        )}
        <span>{delivered} ready</span>
      </div>

      {showGrid && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            alignItems: "start",
            gap: 6,
            marginTop: 11,
          }}
        >
          {complete
            ? variants.map((v) => <DoneThumb key={v.index} variant={v} />)
            : Array.from({ length: Math.max(slotCount, variants.length) }, (_, i) => i + 1).map((index) => {
                const doneVar = byIndex.get(index);
                if (doneVar) return <DoneThumb key={index} variant={doneVar} />;
                return (
                  <SlotTile
                    key={index}
                    index={index}
                    flight={inFlights[index]}
                    qualityMode={qualityMode}
                    preparing={preparing}
                    waking={waking}
                  />
                );
              })}
        </div>
      )}

      {delivered > 0 && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--color-muted2)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ color: "var(--color-violet-l)" }}>✦</span>
          {delivered} variant{delivered !== 1 ? "s" : ""} ready
        </div>
      )}
    </div>
  );
}
