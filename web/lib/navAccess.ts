import { isAgencyExperience } from "./experience";
import { PRIMARY_TABS, type StudioDestination } from "./studioDestinations";

const SOLO_PRIMARY_HREFS = new Set(["/", "/gallery", "/settings/drive"]);

/** Failed-encode leftovers. Operators never use Diagnostics — site admin only. */
export function showDiagnosticsNav(me: {
  auth_required?: boolean;
  is_admin?: boolean;
} | undefined): boolean {
  if (!me) return false;
  if (!me.auth_required) return true;
  return Boolean(me.is_admin);
}

export function showTeamNav(me: {
  role?: string | null;
  is_admin?: boolean;
  experience?: string | null;
  auth_required?: boolean;
} | undefined): boolean {
  if (!(me?.role === "owner" || Boolean(me?.is_admin))) return false;
  return isAgencyExperience(me);
}

/** Instagram Analytics: workspace owners and site admins. Solo owners included. VAs never. */
export function showAnalyticsNav(me: {
  role?: string | null;
  is_admin?: boolean;
  auth_required?: boolean;
} | undefined): boolean {
  if (!me) return false;
  if (me.auth_required === false) return true;
  return me.role === "owner" || Boolean(me.is_admin);
}

/** Connect / Sync / unmatched picker — same gate as the Analytics tab. */
export function canManageInstagram(me: {
  role?: string | null;
  is_admin?: boolean;
  auth_required?: boolean;
  email?: string | null;
} | undefined): boolean {
  return showAnalyticsNav(me);
}

/** Phone + desktop primary row. Solo creators only see Studio, Gallery, Drive. */
export function visiblePrimaryTabs(me: {
  experience?: string | null;
  is_admin?: boolean;
  auth_required?: boolean;
} | undefined): readonly StudioDestination[] {
  if (isAgencyExperience(me)) return PRIMARY_TABS;
  return PRIMARY_TABS.filter((tab) => SOLO_PRIMARY_HREFS.has(tab.href));
}

/**
 * Role gate for extra destinations (Team / Analytics / Admin / Diagnostics).
 * Shared by TopNav so More and the desktop extras agree.
 */
export function extraTabVisible(
  href: string,
  me: {
    auth_required?: boolean;
    is_admin?: boolean;
    role?: string | null;
    experience?: string | null;
  } | undefined,
): boolean {
  if (href === "/diagnostics") return showDiagnosticsNav(me);
  if (href === "/team") return showTeamNav(me);
  if (href === "/analytics") return showAnalyticsNav(me);
  if (href === "/admin") return Boolean(me?.is_admin);
  return false;
}

/** Exact match for Studio ("/"), prefix match for every other destination. */
export function linkActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
