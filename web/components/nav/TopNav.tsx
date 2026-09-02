"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  Cloud,
  FolderOpen,
  GalleryHorizontalEnd,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  Settings2,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import { logout, setAdminView } from "@/lib/api";
import { useAuthMe } from "@/lib/useAuthMe";
import { experienceLabel, normalizeExperience } from "@/lib/experience";
import { extraTabVisible, visiblePrimaryTabs } from "@/lib/navAccess";
import { EXTRA_TABS } from "@/lib/studioDestinations";
import { StatusStrip } from "./StatusStrip";
import { VarimoMark } from "../brand/VarimoMark";
import { VarimoWordmark } from "../brand/VarimoWordmark";

const ICONS = {
  "/": GalleryHorizontalEnd,
  "/gallery": FolderOpen,
  "/drops": PackageCheck,
  "/workflows": Workflow,
  "/settings/drive": Cloud,
  "/team": UsersRound,
  "/analytics": ChartColumn,
  "/admin": ShieldCheck,
  "/diagnostics": Settings2,
} as const;

function linkActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();
  const { data: me } = useAuthMe();
  const [moreOpen, setMoreOpen] = useState(false);
  const allowedExtras = EXTRA_TABS.filter((tab) => extraTabVisible(tab.href, me));
  const primaryTabs = visiblePrimaryTabs(me);

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  async function handleExitView() {
    await setAdminView(null);
    window.location.reload();
  }

  return (
    <>
      <header className="vf-topbar">
        <Link className="vf-brand" href="/" aria-label="varimo Studio home">
          <VarimoMark className="vf-brand-mark" size={22} />
          <VarimoWordmark className="vf-brand-wordmark" />
        </Link>

        <nav className="vf-desktop-nav" aria-label="Primary navigation">
          {primaryTabs.map(({ href, label }) => {
            const Icon = ICONS[href as keyof typeof ICONS];
            const active = linkActive(pathname, href);
            return (
              <Link key={href} href={href} className="vf-nav-link" data-active={active}>
                <Icon size={15} strokeWidth={1.8} /> {label}
              </Link>
            );
          })}
          {allowedExtras.length > 0 && <span className="vf-nav-separator" aria-hidden="true" />}
          {allowedExtras.map(({ href, label }) => {
            const Icon = ICONS[href as keyof typeof ICONS];
            const active = linkActive(pathname, href);
            return (
              <Link key={href} href={href} className="vf-nav-link vf-nav-link-extra" data-active={active}>
                <Icon size={15} strokeWidth={1.8} /> {label}
              </Link>
            );
          })}
        </nav>

        <div className="vf-topbar-actions">
          <StatusStrip />
          {(me?.email || allowedExtras.length > 0) && (
            <>
              {me?.email && (
                <span className="vf-account-email" title={me.email}>
                  {me.email}
                  <span className="vf-experience-label">
                    {" "}
                    {experienceLabel(normalizeExperience(me.experience))}
                  </span>
                </span>
              )}
              {me?.email && <button type="button" className="vf-logout" onClick={handleLogout}><LogOut size={14} /> Log out</button>}
              <button
                type="button"
                className="vf-more-trigger"
                aria-expanded={moreOpen}
                aria-controls="vf-mobile-more"
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal size={17} /> More
              </button>
            </>
          )}
        </div>
      </header>

      {moreOpen && (me?.email || allowedExtras.length > 0) && (
        <aside className="vf-mobile-more" id="vf-mobile-more" aria-label="More navigation">
          {me?.email && <span className="vf-mobile-email">{me.email}</span>}
          {allowedExtras.length > 0 && (
            <nav className="vf-mobile-extra-links">
              {allowedExtras.map(({ href, label }) => {
                const Icon = ICONS[href as keyof typeof ICONS];
                return <Link key={href} href={href} onClick={() => setMoreOpen(false)}><Icon size={16} /> {label}</Link>;
              })}
            </nav>
          )}
          {me?.email && <button type="button" className="vf-mobile-logout" onClick={handleLogout}><LogOut size={15} /> Log out</button>}
        </aside>
      )}

      {me?.viewing_other && (
        <div className="vf-viewing-banner">
          <span>Viewing {me.workspace_name || "another studio"}</span>
          <button type="button" onClick={handleExitView}>Exit to my studio</button>
        </div>
      )}

      <nav className="vf-mobile-tabs" data-count={primaryTabs.length} aria-label="Primary navigation">
        {primaryTabs.map((item) => {
          const Icon = ICONS[item.href as keyof typeof ICONS];
          const active = linkActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} data-active={active}>
              <Icon size={17} strokeWidth={1.8} />
              <span>{item.short ?? item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
