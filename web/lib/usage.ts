/** Operator-facing week readout. Packs stay attributed to the signed-in email. */

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
