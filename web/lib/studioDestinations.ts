/**
 * Complete Studio information architecture.
 *
 * The v1 README only listed Studio / Gallery / variant panel / Diagnostics.
 * Redesigns must start from this list — every shipped tab and who sees it.
 *
 * TopNav PRIMARY comes from `tab: "primary"`. Role extras use `tab: "extra"`.
 */

export type NavAudience = "everyone" | "owner" | "admin";
export type NavTab = "primary" | "extra" | "none";

export type StudioDestination = {
  href: string;
  label: string;
  short?: string;
  audience: NavAudience;
  tab: NavTab;
  summary: string;
};

export const STUDIO_DESTINATIONS: readonly StudioDestination[] = [
  {
    href: "/",
    label: "Studio",
    audience: "everyone",
    tab: "primary",
    summary:
      "Generate: drop files or pick from Drive, set copies, Fast (HQ coming soon), captions, Advanced, live queue.",
  },
  {
    href: "/gallery",
    label: "Gallery",
    audience: "everyone",
    tab: "primary",
    summary:
      "7-day packs by source. Thumbs, uniqueness, Send to Drive, Sent/Flagged chips, variant sheet.",
  },
  {
    href: "/drops",
    label: "Drops",
    audience: "everyone",
    tab: "primary",
    summary:
      "Drive-sent packs this week. Unlabeled = pass. Flagged / duplicate rejected = miss.",
  },
  {
    href: "/workflows",
    label: "Workflows",
    short: "Flows",
    audience: "everyone",
    tab: "primary",
    summary:
      "Watch folder auto-poll, inbox-to-output Drive folders, cancel a live pack.",
  },
  {
    href: "/settings/drive",
    label: "Drive",
    audience: "everyone",
    tab: "primary",
    summary:
      "Share the varimo Drive email with a folder, paste the link, captions, Drop Ledger, password.",
  },
  {
    href: "/team",
    label: "Team",
    audience: "owner",
    tab: "extra",
    summary: "Agency owner invites VAs into this studio. Solo creators cannot invite.",
  },
  {
    href: "/analytics",
    label: "Analytics",
    short: "Stats",
    audience: "owner",
    tab: "extra",
    summary:
      "Owner-only Instagram Insights: ranked originals, Sync views onto packs, Unmatched Reels tab.",
  },
  {
    href: "/admin",
    label: "Admin",
    audience: "admin",
    tab: "extra",
    summary: "Site admin: workspaces, join/new-workspace invites, view-as.",
  },
  {
    href: "/diagnostics",
    label: "Diagnostics",
    audience: "admin",
    tab: "extra",
    summary: "Failed encodes (uniqueness miss / corrupt / best_effort). Operators never use this.",
  },
  {
    href: "/login",
    label: "Login",
    audience: "everyone",
    tab: "none",
    summary: "Invite-only email + password or Google. No app tabs on this page.",
  },
] as const;

/** Phone bottom bar + desktop primary row. */
export const PRIMARY_TABS = STUDIO_DESTINATIONS.filter((d) => d.tab === "primary");

/** Team / Analytics / Admin / Diagnostics — role-gated in TopNav. */
export const EXTRA_TABS = STUDIO_DESTINATIONS.filter((d) => d.tab === "extra");

/** Surfaces that are not top-level tabs but must be in any redesign. */
export const STUDIO_NESTED_SURFACES = [
  {
    name: "Variant sheet",
    opens_from: "/gallery",
    summary: "Compare slider, scrub, quality, uniqueness, platform flag, post URL, download.",
  },
  {
    name: "Send to Drive",
    opens_from: "/gallery",
    summary: "Pick destination + caption folder; split a pack across folders.",
  },
  {
    name: "Drive picker",
    opens_from: "/",
    summary: "Import source files from a saved Drive destination.",
  },
  {
    name: "Watch progress",
    opens_from: "/ and /workflows",
    summary: "Live job tiles, cancel, re-attach after reload.",
  },
  {
    name: "Analytics pack sheet",
    opens_from: "/analytics",
    summary: "Tap a ranked original for pack totals, trial-reel Insights per @handle, and tracked Reels.",
  },
  {
    name: "Analytics unmatched picker",
    opens_from: "/analytics",
    summary: "Unmatched Reels tab. Pick a Gallery pack, then link the Reel you posted. Older pre-Varimo posts stay here.",
  },
] as const;
