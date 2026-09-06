/** Desktop live/progress rail — fixed column, slightly roomier than 400. */
export const STUDIO_LIVE_RAIL_PX = 460;
/** Phone Generate dock: CTA + Cancel pack + bottom inset. */
export const STUDIO_GENERATE_DOCK_H_PX = 120;
/** Dark SideNav rail — shown from 640px up (iPad included). */
export const STUDIO_SIDENAV_PX = 264;
/** Insights drawer width once the board still has room beside it. */
export const ANALYTICS_SHEET_PX = 480;
/** Below this, the Insights sheet fills the column next to SideNav (iPad). */
export const ANALYTICS_SHEET_WIDE_MIN_PX = 1180;

export function studioShellClass(_hasJob?: boolean): string {
  return "studio-shell";
}

export function studioProgressIdleClass(hasJob: boolean): string {
  return hasJob ? "studio-progress" : "studio-progress studio-progress--idle";
}
