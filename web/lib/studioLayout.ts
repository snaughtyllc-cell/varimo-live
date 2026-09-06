/** Desktop live/progress rail — fixed column, slightly roomier than 400. */
export const STUDIO_LIVE_RAIL_PX = 460;
/** Phone Generate dock: CTA + Cancel pack + bottom inset. */
export const STUDIO_GENERATE_DOCK_H_PX = 120;

export function studioShellClass(_hasJob?: boolean): string {
  return "studio-shell";
}

export function studioProgressIdleClass(hasJob: boolean): string {
  return hasJob ? "studio-progress" : "studio-progress studio-progress--idle";
}
