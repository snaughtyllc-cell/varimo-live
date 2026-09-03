# Studio information architecture (redesign source of truth)

Codex and any other redesign pass must use this page, not the four-row
"Screens" table that used to live in `web/README.md`. That table was the
first-version list (Studio / Gallery / Variant side-panel / Diagnostics)
and hid every destination shipped after v1.

Live product: https://varyforge-studio-production.up.railway.app

Machine-readable catalog: `web/lib/studioDestinations.ts`.
`TopNav` renders `PRIMARY_TABS` / `EXTRA_TABS` from that file.
The catalog test (`web/lib/__tests__/studioDestinations.test.ts`)
fails if a `web/app/**/page.tsx` route is missing from the list.

Historical June 2026 frontend specs (`docs/superpowers/specs/2026-06-29-control-plane-frontend-design.md`
and `docs/superpowers/plans/2026-06-29-control-plane-frontend.md`)
describe v1 only. Do not treat them as the current product.

## Who sees what

| Audience | Tabs |
|---|---|
| Solo creator | **Studio · Gallery · Drive** + **Analytics** (More; owner) |
| Agency member | **Studio · Gallery · Drops · Workflows · Drive** (no Analytics) |
| Agency owner | + **Team** (invite VAs) + **Analytics** |
| Site admin (`SITE_ADMIN_EMAILS`) | all of the above + **Admin · Diagnostics** |
| Unauthenticated | **Login** only |

Missing/untagged `experience` is **agency** so Jeff Tingz and older
operator studios keep Team. New-studio invites write **solo**. Flip a
workspace to Agency in Admin when that studio should invite VAs.

Phone (`< 640px`) only has room for the primary tabs that audience
can see. Team / Analytics / Admin / Diagnostics sit under **More**.
Desktop shows extras in the top row when the session is allowed to
see them. Analytics is owner-only (solo owners included). VAs never
see it.

Watch is **not** a tab. It lives inside Studio + Workflows as a job
row + progress card.

## Destinations (complete)

| Tab | Route | Audience | Phone bar | What it is |
|---|---|---|---|---|
| Studio | `/` | everyone | yes | Drop files or pick from Drive, set copies, Fast (HQ coming soon), Advanced, live queue. |
| Gallery | `/gallery` | everyone | yes | 7-day packs by source. Thumbs, uniqueness, Send to Drive, Sent/Flagged chips. |
| Drops | `/drops` | agency | yes | Drive-sent packs this week. Unlabeled = pass. Flagged / duplicate rejected = miss. |
| Workflows | `/workflows` | agency | yes (label **Flows**) | Watch folder auto-poll, inbox-to-output Drive folders, cancel a live pack. |
| Drive | `/settings/drive` | everyone | yes | Share varimo Drive email, paste folder link, captions, Drop Ledger, password. Owners also Connect Instagram testers here. |
| Team | `/team` | agency owner / site admin | More | Workspace owner invites VAs. Solo creators cannot invite. |
| Analytics | `/analytics` | workspace owner / site admin (or auth off) | More (label **Stats**) | Instagram Insights: ranked originals, Connect testers, Sync views onto packs. Opening Stats pulls Graph again when the last Insights pass is ≥2 hours old and shows change since last look. Unmatched Reels (older posts) live in a tab. VAs cannot open this. |
| Admin | `/admin` | site admin | More | Workspaces, join/new-workspace invites, view-as. |
| Diagnostics | `/diagnostics` | site admin (or auth off) | More | Failed encodes (`uniqueness_fail` / `corrupt` / `best_effort`). Operators never use this. |
| Login | `/login` | unauthenticated | — | Invite-only email + password or Google. No app tabs. |

## Nested surfaces a redesign must include

These are not tabs. They open from a parent destination and must stay
in the redesign, not get dropped because they are missing from the
old four-row list.

| Surface | Parent | How it opens |
|---|---|---|
| Variant sheet | Gallery | Tap a finished copy. Compare slider, scrub, editable caption, uniqueness, platform flag, post URL, download. |
| Pack Options | Gallery | On a pack row, **Options** rewrites every copy's caption from a seed. Videos stay the same. |
| Send to Drive | Gallery / variant sheet | Pick destination + caption folder; split a pack across folders. |
| Drive picker | Studio | Import source files from a saved Drive destination. |
| Watch / queue / cancel | Studio + Workflows | Live job tiles, cancel, re-attach after reload. Workflows can caption from each Drive filename. |
| Analytics pack sheet | Analytics | Tap a ranked original. Pack totals, trial-reel Insights per @handle, and tracked Reels live here. Account roles (trial vs main) stay operator knowledge — no lane picker. |
| Unmatched Reel picker | Analytics | **Unmatched Reels** tab. Pick a Gallery pack, then link the Reel that belongs to it. Pre-Varimo posts stay here and do not crowd ranked originals. |

## What not to invent

- Do not add a Watch tab. Watch stays inside Studio + Workflows.
- Do not remove Drops, Workflows, Drive, Team, Analytics, or Admin from
  the catalog — they are live. Solo chrome hides Drops, Workflows, and
  Team. Analytics stays under More for owners (including solo).
- Do not put Admin / Diagnostics / Analytics in the phone bottom bar.
  They stay under More so VAs never get a sixth primary tab.
- Auth gating stays in `web/lib/navAccess.ts` (`showTeamNav`,
  `showAnalyticsNav`, `showDiagnosticsNav`). Site admin is
  `SITE_ADMIN_EMAILS`. Instagram Connect/Sync is owners only.
