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

export function remainingPct(
  usedVariants: number,
  includedVariants: number | null | undefined,
): number {
  const included = includedVariants ?? 0;
  if (included <= 0) return 0;
  const left = Math.max(0, included - Math.max(0, usedVariants));
  return Math.round((100 * left) / included);
}

export function sidebarUsage(
  usage:
    | {
        uncapped?: boolean;
        used_variants?: number;
        included_variants?: number | null;
        included_packs?: number | null;
        remaining_pct?: number | null;
      }
    | null
    | undefined,
): { pct: number; label: string } | null {
  if (!usage) return null;
  if (usage.uncapped) {
    return { pct: usage.remaining_pct ?? 100, label: "uncapped" };
  }
  const includedPacks = usage.included_packs ?? 0;
  const includedVariants = usage.included_variants ?? includedPacks * 8;
  if (includedVariants <= 0) return null;
  const pct =
    usage.remaining_pct ?? remainingPct(usage.used_variants ?? 0, includedVariants);
  const leftPacks = Math.max(0, includedVariants - (usage.used_variants ?? 0)) / 8;
  const shown =
    leftPacks === Math.floor(leftPacks) ? String(leftPacks) : leftPacks.toFixed(1);
  return { pct, label: `${shown} of ${includedPacks} left` };
}
