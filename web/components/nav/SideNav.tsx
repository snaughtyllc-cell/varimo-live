"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/api";
import { useAuthMe } from "@/lib/useAuthMe";
import { experienceLabel, normalizeExperience } from "@/lib/experience";
import { extraTabVisible, linkActive, visiblePrimaryTabs } from "@/lib/navAccess";
import { EXTRA_TABS } from "@/lib/studioDestinations";
import { VarimoWordmark } from "../brand/VarimoWordmark";

/** Material Symbols Rounded ligature names, keyed by destination href. */
const NAV_ICONS = {
  "/": "movie_edit",
  "/gallery": "photo_library",
  "/analytics": "monitoring",
  "/drops": "inventory_2",
  "/workflows": "schema",
  "/settings/drive": "cloud",
  "/team": "group",
  "/admin": "shield",
  "/diagnostics": "monitor_heart",
} as const;

/**
 * Desktop-only 240px dark rail — replaces `.vf-desktop-nav` from the old TopNav.
 * Mounted alongside TopNav in AuthGate (a sibling, not a child of TopNav);
 * CSS (`.vf-sidenav`) hides this below the desktop breakpoint, where the phone
 * top bar + bottom tabs take over unchanged.
 */
export function SideNav() {
  const pathname = usePathname();
  const { data: me } = useAuthMe();
  const primaryTabs = visiblePrimaryTabs(me);
  const allowedExtras = EXTRA_TABS.filter((tab) => extraTabVisible(tab.href, me));
  const initials = me?.email ? me.email.slice(0, 2).toUpperCase() : "";

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  return (
    <aside className="vf-sidenav" aria-label="Studio navigation">
      <Link className="vf-sidenav-brand" href="/" aria-label="varimo Studio home">
        <VarimoWordmark className="vf-brand-wordmark" />
      </Link>

      <nav className="vf-sidenav-primary" aria-label="Primary navigation">
        {primaryTabs.map(({ href, label }) => {
          const active = linkActive(pathname, href);
          return (
            <Link key={href} href={href} className="vf-sidenav-link" data-active={active}>
              <span className="material-symbols-rounded" aria-hidden="true">
                {NAV_ICONS[href as keyof typeof NAV_ICONS]}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {allowedExtras.length > 0 && (
        <>
          <div className="vf-sidenav-divider" />
          <div className="vf-sidenav-section-label">Workspace</div>
          <nav className="vf-sidenav-extra" aria-label="Workspace navigation">
            {allowedExtras.map(({ href, label }) => {
              const active = linkActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className="vf-sidenav-link vf-sidenav-link-extra"
                  data-active={active}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    {NAV_ICONS[href as keyof typeof NAV_ICONS]}
                  </span>
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </>
      )}

      <div className="vf-sidenav-spacer" />

      {me?.email && (
        <div className="vf-sidenav-account">
          <span className="vf-sidenav-avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="vf-sidenav-account-info">
            <span className="vf-sidenav-account-email" title={me.email}>
              {me.email}
            </span>
            <span className="vf-sidenav-account-plan">
              {experienceLabel(normalizeExperience(me.experience))}
            </span>
          </span>
          <button
            type="button"
            className="vf-sidenav-logout"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              logout
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
