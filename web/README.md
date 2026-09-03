# varimo Studio — web frontend

Next.js 16 App Router UI for the variant-maker engine (the `varimo` control plane).
Pure client of the FastAPI backend via a same-origin dev proxy.

**Redesign / Codex:** do not use the old four-screen list
(Studio / Gallery / variant side-panel / Diagnostics). That was v1.
The live product has nine destinations. Source of truth:
[`docs/ops/studio-ia.md`](../docs/ops/studio-ia.md) and
`web/lib/studioDestinations.ts`.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node >= 18.18** | Check with `node -v` |
| **ffmpeg with libvmaf** | Required by the engine; verify with `ffmpeg -filters \| grep vmaf` |
| **Python venv at `./.venv`** | Created from the repo root with `pip install -e ".[server]"` (or the `[dev]` extra). Must expose the `variant-server` entry point. |

---

## Install

```bash
cd web
npm install
```

---

## Running locally

You need both the API (port 8000) and the Next.js dev server (port 3000) running.

### Option A — run both with one command (from the repo root)

```bash
./dev.sh [data-dir]
# data-dir defaults to ./.vmdata
```

The script starts the API in the background and the web dev server in the foreground.
Ctrl-C kills both.

### Option B — run them separately

**Terminal 1 — API:**
```bash
./.venv/bin/variant-server --data-dir <data-dir>
# Listens on http://localhost:8000
```

**Terminal 2 — web:**
```bash
cd web
npm run dev
# Listens on http://localhost:3000
```

---

## Proxy configuration

The environment variable `API_PROXY_TARGET` controls where the frontend routes API
traffic (default: `http://localhost:8000`).

```bash
# web/.env.local
API_PROXY_TARGET=http://localhost:8000
```

It is read in two places:

1. **`next.config.ts` rewrites** — `/api/*` requests made by the browser are forwarded to
   the backend during `npm run dev`.

2. **SSE Route Handler** (`app/api/jobs/[job_id]/events/route.ts`) — the dev-proxy rewrite
   buffers `text/event-stream` before forwarding it, which breaks SSE. This frontend-only
   Route Handler proxies the SSE stream itself so the browser receives events incrementally.
   It reads `API_PROXY_TARGET` at request time, so changing the env var and restarting the
   dev server is all that is needed.

No backend changes are required by the frontend.

---

## Tests

```bash
cd web
npm test
```

Expected output (all 7 suites, 24 tests):

```
Test Files  7 passed (7)
      Tests  24 passed (24)
```

Suites covered: `format`, `api`, `progress`, `useJobProgress`, `files`, `gallery`, `media`.

---

## Production build

```bash
cd web
npm run build
```

Compiles TypeScript, runs Turbopack, and generates the optimised output in `.next/`.
The build must succeed with no type errors before merging.

---

## Screens

The four-row table that used to live here (Studio / Gallery / Variant
side-panel / Diagnostics) was the **first-version** list. It hid every
destination shipped after v1 — Drops, Workflows, Drive, Team, Admin —
which is why a redesign pass that only read this README could not see
the live product.

**Use [`docs/ops/studio-ia.md`](../docs/ops/studio-ia.md) as the redesign
source of truth.** The machine-readable catalog is
`web/lib/studioDestinations.ts`. A test fails if a `web/app/**/page.tsx`
route is missing from that catalog.

| Tab | Route | Audience | Phone bar | What it does |
|---|---|---|---|---|
| **Studio** | `/` | everyone | yes | Drop files or pick from Drive, set copies, Fast vs HQ, Advanced, live queue. Reload mid-run re-attaches. |
| **Gallery** | `/gallery` | everyone | yes | 7-day packs by source. Thumbs, uniqueness, Send to Drive, Sent/Flagged chips. |
| **Drops** | `/drops` | everyone | yes | Drive-sent packs this week. Unlabeled = pass. Flagged / duplicate rejected = miss. |
| **Workflows** | `/workflows` | everyone | yes (label **Flows**) | Watch folder auto-poll, inbox-to-output Drive folders, cancel a live pack. |
| **Drive** | `/settings/drive` | everyone | yes | Connect Google, destinations, caption bank, Drop Ledger, password. |
| **Team** | `/team` | owner / site admin | More | Workspace owner invites VAs into this studio. |
| **Analytics** | `/analytics` | owner / site admin | More (label **Stats**) | Instagram Insights: ranked originals, tester Connect/Sync, and Unmatched Reels. VAs cannot open it. |
| **Admin** | `/admin` | site admin | More | Workspaces, join/new-workspace invites, view-as. |
| **Diagnostics** | `/diagnostics` | site admin (or auth off) | More | Failed encodes (`uniqueness_fail` / `corrupt` / `best_effort`). Operators never use this. |
| **Login** | `/login` | unauthenticated | — | Invite-only email + password or Google. No app tabs. |

Nested (not tabs — a redesign must still include them):

| Surface | Opens from | What it is |
|---|---|---|
| **Variant sheet** | Gallery card | Compare slider, scrub, quality, uniqueness, platform flag, post URL, download. |
| **Send to Drive** | Gallery / variant sheet | Pick destination + caption folder; split a pack across folders. |
| **Drive picker** | Studio | Import source files from a saved Drive destination. |
| **Watch / queue / cancel** | Studio + Workflows | Live job tiles, cancel, re-attach after reload. |
| **Analytics pack sheet** | Analytics | Tap a ranked original for pack totals, per-account main / trial / growth Insights, and tracked Reels. |

Phone (`< 640px`) shows the five everyone-tabs. Team / Analytics / Admin /
Diagnostics sit under **More**. Desktop shows extras in the top row
when the session is allowed. Auth gating: `web/lib/navAccess.ts`.

---

## Stage 2 note (Vercel deployment)

Set `API_PROXY_TARGET` to the deployed FastAPI URL and redeploy the Next.js app to Vercel.
No component or route changes are required — the SSE Route Handler and rewrites both read
the same env var at runtime.

```bash
# In the Vercel project environment variables:
API_PROXY_TARGET=https://api.example.com
```
