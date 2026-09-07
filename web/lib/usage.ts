/** Operator-facing week readout. Packs stay attributed to the signed-in email. */

export type WorkspacePlan = "payg" | "creator" | "studio" | "agency" | "internal";

export const PLAN_OPTIONS: { id: WorkspacePlan; label: string }[] = [
  { id: "payg", label: "Pay as you go" },
  { id: "creator", label: "Creator" },
  { id: "studio", label: "Studio" },
  { id: "agency", label: "Agency" },
  { id: "internal", label: "Internal (uncapped)" },
];

export function memberWeekCopy(member: {
  week_fast?: number;
  week_hq?: number;
  week_packs?: number;
}): string {
  const fast = member.week_fast ?? 0;
  const hq = member.week_hq ?? 0;
  const packs = member.week_packs ?? 0;
  if (fast === 0 && hq === 0 && packs === 0) return "This week: no packs";
  const packLabel = packs === 1 ? "1 pack" : `${packs} packs`;
  return `This week: ${fast} Fast · ${hq} HQ · ${packLabel}`;
}

export function monthMeterCopy(usage: {
  uncapped?: boolean;
  meter_line?: string | null;
} | null | undefined): string | null {
  if (!usage || usage.uncapped) return null;
  return usage.meter_line ?? null;
}
