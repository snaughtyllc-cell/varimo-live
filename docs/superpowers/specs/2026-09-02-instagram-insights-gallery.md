# Instagram Insights in Gallery (Track → Amplify)

**Date:** 2026-09-02  
**Status:** Design / building — Analytics tab + Connect testers (G1–G4).  
**Product name:** VaryForge  
**Jeff (2026-09-02):** Meta developer app → operator Connect Instagram → pull
Insights → Gallery shows the pack (300k views, ranked copies) → suggestions
(dead original vs winner) → mint more variants of winners. Same agency
testing loop, productized. Not “open Insights on every Reel.”

**Depends on:** `post_url` paste (`2026-08-20-post-url-tracking.md`), Gallery
source groups, `regenerate(source_id, n)`, Drive-style Jeff-once OAuth.
**North star:** `2026-08-20-butter-loop.md` F3 + F4.

## Verdict

Yes. This is the missing half of the product.

VaryForge already owns the hard part: unique files that look like originals.
Without a scoreboard on **those files**, operators still live in Instagram
Insights, one Reel at a time, then guess which original to clone. Butter
sells Post → Track → Amplify as glue. We already wrote that loop. What we
did not ship is **Track with real numbers on the pack**, because we refused
scraping and account proxies.

A Meta **developer app** is the allowed door. It is the same shape as
Connect Google: Jeff configures the app once; each workspace signs in as
**their** Instagram professional account; Studio pulls what Insights already
shows, then rolls it up by **source / pack / copy** — identity Instagram
does not have.

That join is the product. A generic IG analytics dashboard without variant
identity is just another Insights clone. Do not build that.

## What “game changer” means here (operator feel)

Five originals in Gallery, each with a pack of copies. After they post:

| They should see in Gallery | Not this |
|---|---|
| This **pack** did 312,400 views (sum of matched copies) | Open 20 Reels in the IG app |
| Copy v07 is 80% of that; v12 is dead | Spreadsheet of permalinks |
| **This original** is the million-view winner vs the other four | “v07 looks lucky” with no source grouping |
| Suggestion: mint 20 more of the winner (same Fast engine) | Overlays / hook scrambles |
| Suggestion: this original’s copies are all quiet — try a new source | A fake “flagged” stamp from views |

Auto-tracking is the default once an account is connected. Suggestions are
copy + one click first. Auto-generate more of a winner is a **workspace
toggle**, not day-one behavior.

## Two different truths (do not mash them)

| Signal | What it is | Where it lives | Who says so |
|---|---|---|---|
| **Policy / land** | Passed, duplicate-rejected, flagged | `platform_result` + Drops / Drop Ledger | Human oracle (VA marks it). Unlabeled = pass. |
| **Distribution / work** | Views, reach, likes, comments, shares, saved | Insights snapshot on the variant | Instagram, via official API |

A copy can **pass** (not taken down) and still get **zero push**. That is
exactly the agency read Jeff named. Insights do **not** expose “this was
flagged” or “this is shadowbanned.” Dead views are a **heuristic**, labeled
as potential, never as a detector verdict.

Phase 12 (`2026-08-18-platform-outcome-learning.md`) stays the policy-learning
track. This spec does not un-skip 12c. Do not feed view counts into the
uniqueness gate.

## Why official Meta, not a scraper

| Approach | Stance |
|---|---|
| **Instagram API with Instagram Login** (`graph.instagram.com`) | **This track.** Operator Connect. Professional (Business/Creator) accounts. |
| Facebook Login + Page-linked IG (`graph.facebook.com`) | Fallback only if Instagram Login cannot cover a client. More Page / BM dance. |
| Paste `post_url` only (v1, shipped) | Keep. Join key when they pasted. Open post still works with no Connect. |
| Public oEmbed / OG | Optional extra; fails on 18+ / restricted. Not the scoreboard. |
| Logged-in browser farm / Eagle / “UI remote” as the VA | **Out.** That is account-proxy. `CLAUDE.md` forbids it. |

“UI remote” in the pitch is **OAuth consent on Instagram**, same as Connect
Google — not Studio driving the Instagram app as someone else.

## Meta constraints (honest)

Two different clocks. Do not mix them.

### Testers first (this is the real path)

**Yes — add people as testers. You do not need App Review to run Insights
for invite-only Studio.**

Meta’s own rule: if the app is only used by people who have a **role on
the app**, Standard Access is enough. Instagram Platform says the same:
if you only serve accounts you own or manage, Standard Access is all
you need.

That is the Drive pattern we already run (OAuth test users). Ops:

1. App Dashboard → **App roles → Roles** → add **Instagram Tester**
   (`@handle`, not email).
2. They accept in Instagram: Settings → Apps and websites → **Tester
   invites**. Pending invites do not Connect.
3. Their IG must be **Professional** (Business or Creator). Then Studio
   Connect works; Insights work.

Caps (Meta App Roles docs): **~50 testers** on an app not linked to a
verified Business; **up to 500** testers+analytics if the app is on a
verified Business Manager. Jeff adding each new operator / client handle
when he invites the workspace is the intended loop.

Meta’s tester policy wording is “employee or acting on your behalf as a
tester.” Invite-only operators Jeff onboarded fits that better than
public signup. Do **not** use testers as a fake public app (no
self-serve Connect for strangers).

You are not missing a hidden Meta step for this path.

### Advanced Access (only if strangers Connect with no role)

Needed when an Instagram that is **not** a tester / admin / developer
must grant Insights — e.g. public Studio, or “here’s the URL, Connect
without Jeff adding your @handle.”

They are **not** reviewing uniqueness, Fast, VMAF, or the variant
engine. They are reviewing: *does this app use Instagram data the way
the permission allows, and can a reviewer reproduce it?*

Submission (official App Review + screen-recording guide):

| They look at | What that means for us |
|---|---|
| **Which permissions** | Only `instagram_business_basic` (read media to match posts) and `instagram_business_manage_insights` (views/reach on Analytics + Gallery). Do **not** request publish, comments, DMs, or Page scopes “just in case.” |
| **Written use case** | English, step-by-step: operator Connects IG → Studio lists Reels → matches to Gallery copies → shows views on Analytics and compact Gallery surfaces. Allowed-usage checkbox per permission. |
| **Screencast per permission** | Logged-out → Studio login → **Instagram Login consent** (must see the grant) → Analytics + Gallery sheet showing Insights numbers that permission unlocked. High-res, English UI, no audio. They follow this video when they test. |
| **Reviewer can load the app** | Live Studio URL + a working invite / test login. Not a private intranet with no UI. |
| **Business Verification** | Legal entity docs matching the Business portfolio that owns the app. Required for Advanced Access (since 2023). |
| **Privacy policy URL** | Public page shown on Meta’s consent screen. What we store (tokens, view counts), why, how to disconnect / delete. |
| **App extras** | 1024×1024 icon, category, business email. ≥1 successful Graph call with that permission in the last 30 days (`graph.instagram.com` for `instagram_business_*`). |
| **Allowed use** | Insights for the connected account’s own performance in *our* UI — not scraping other people’s content, not a detector, not posting. |

After Advanced Access: annual **Data Use Checkup**. Rejections are
usually: skipped consent screen, numbers never shown in the UI (API
only), extra unused permissions, reviewer cannot log in, privacy policy
404, or Business Verification incomplete.

Until we want Connect-without-a-tester-invite, **do not start this.**
Ship G1–G4 on testers.

### Insights data lag (also not App Review)

Instagram’s numbers lag. A Reel posted 20 minutes ago often still reads
**0 views** in the API even if it is getting push. Do not scream “this
isn’t being pushed” at T+20. Suggestions need an age floor (see G4).
That delay exists even after Connect works.

### Other API notes

- **Tokens expire.** Store and refresh long-lived user tokens per
  connected IG user. Disconnect deletes the file.
- **Metric name:** use **`views`** (replaces deprecated `impressions` /
  `plays` / `video_views` on current Graph versions). Reach +
  likes/comments/shares/saved stay useful. If `views` errors on a given
  login type, fail that metric honestly; do not silently substitute a dead
  field.
- **No “flagged” field.** Never invent one from the API.

## Identity (the join)

We are still not the poster. Repurpose / the phone / a VA publishes. After
Connect, that account’s recent media shows up on Graph (`permalink`,
`caption`, `id`, timestamp). Studio matches each Reel to **one Gallery
copy**.

Caption matching is a **hint**, not the id. It works when the posted
caption is unique on that connected account and still equals the caption
Studio assigned. It fails in the loop we already run:

- Caption **banks reuse lines** when a folder is low (“a 20-pack will
  reuse lines”).
- **Main / trial / growth** share one niche caption folder — three
  accounts can post the same caption on different files.
- Drive filenames flatten newlines / strip `/ \`; the IG caption may
  not be byte-identical.
- VAs edit the caption on the phone; IG truncates long ones.

So: auto-link **only** when the caption is a **unique** match on **that**
connected `@handle` (normalized). If two copies share the line, or the
Reel caption does not uniquely hit one variant, do not guess — picker.

Stable keys, in order:

1. **`ig_media_id`** once matched (survives later caption edits).
2. **Normalized permalink** ↔ `post_url` (v1 paste, or auto-filled from
   Graph `permalink`).
3. **Unique caption on that connected account** — first-pass auto-link
   only. Never across accounts. Never if the line is used twice in the
   pack or the bank.
4. **`job_id` + `source_id` + variant index** — Studio identity. Never
   the Drive display name after Repurpose rename.

Optional later (only if unique-caption miss rate is painful): a **short
id prefix** on the caption Studio already writes (`v07_8a3f__` + hook),
same idea as Drop Ledger 12b. That is a unique join on purpose. Do not
lead with it; banks are marketing copy.

Unmatched recent Reels get a **picker** on the pack (“this IG post is
this copy”). One click stores `ig_media_id` + `post_url`; after that,
captions can change and tracking still holds.

`drop_url` stays Drive file id. `post_url` stays live permalink. Insights
hang off the variant next to those, not on the ledger as a second truth.

## Where it shows (Analytics tab)

Studio IA: Studio · Gallery · **Analytics** · Drops · Workflows · Drive.
Phone short label **Stats**.

| Surface | What to add |
|---|---|
| **Analytics** (`/analytics`) | Scoreboard: totals, ranked originals, Sync insights, generate 20 more of winner, quiet/winner suggestions. **InstagramPanel** (Connect / connected @handles / Disconnect). OAuth callback lands on `/analytics?ig=connected`. |
| **Drive** | Same **InstagramPanel** — Connect adds another @handle (main/trial/growth); never replaces other accounts. Drive Google OAuth stays one shared mailbox (site-admin Connect). |
| **Gallery pack header** | Compact: total views for matched copies. “12 of 20 linked.” Winner / quiet hint line. |
| **Gallery tile** | Compact views (and a dead/quiet mark only after G4 floors). Existing uniqueness + Flagged chips stay. |
| **Variant sheet** | Views / reach / engagement + last synced. Keep paste + Passed/Duplicate/Flagged. |
| **Drops** | Optional pack-level views once G3 exists. Drops is still the policy board (unlabeled = pass). |

Watch is not a tab.

## Amplify (winners → more unique files)

The engine already has `JobStore.regenerate(source_id, n)` (Gallery
shortfall / “add copies”). Amplify is that button with a **source chosen by
Insights**, not a new renderer.

- Same Fast (or the job’s quality mode), same uniqueness gate, new seeds.
- **Unit of winning is the source** (the original), not a lucky copy. We
  mint more variants of the original that is working — agency practice.
- Do **not** clone the winning copy’s exact filtergraph. New samples.
- Do **not** amplify a source whose copies are all quiet. That is the
  “try a new original” suggestion.

Auto-amplify (G5): workspace setting, max packs per day, never while a job
is running for that source, never from unmatched (0 linked posts).

## Suggested slices (when we build)

### G0 — this spec (done in this PR)

No code. Cross-links from butter-loop F4, post-url v3, after-sales, IA.

### G1 — Connect Instagram (workspace OAuth)

**InstagramPanel** on Drive and Analytics → **Connect Instagram** →
Instagram Login consent → callback stores token at
`{workspace}/instagram/account_{user_id}.json` → redirect
`/analytics?ig=connected` → status shows @handle. Each Connect **adds**
a tester account; never replaces others.

Env (Jeff / Railway, not operators):

- `VARIANT_IG_APP_ID`
- `VARIANT_IG_APP_SECRET`
- `VARIANT_IG_REDIRECT_URI` (default
  `https://<studio-host>/api/instagram/oauth/callback`)

**Box:** new `variant_maker/server/instagram_oauth.py` + routes in `app.py`
(oauth start/callback/status/disconnect only), Drive-page card,
server tests with a fake token file. **Not:** sampler, uniqueness, posting.

Permissions: `instagram_business_basic`,
`instagram_business_manage_insights`. No `instagram_content_publish`.

### G2 — Sync insights onto linked variants

- `GET /{ig-user-id}/media` (permalink, caption, timestamp, media product type)
- `GET /{ig-media-id}/insights?metric=views,reach,likes,comments,shares,saved`
  (request only metrics valid for that media type; skip missing)
- Match in order: existing `ig_media_id` → permalink/`post_url` → **unique**
  caption on this `@handle` → else unmatched (picker, do not guess)
- Persist snapshot on the variant (`job.json`): counts + `fetched_at`
- Refresh: on Gallery load (rate-limit) + a manual **Sync insights**
- No Redis. No always-on queue. Same “poll when they look” pattern as
  other Studio status.

**Box:** `instagram_insights.py`, variant fields, `POST /api/instagram/sync`,
tests with recorded JSON fixtures (no live Graph in CI).

### G3 — Gallery rollup

Pack header: **Σ views** of matched copies, linked count. Tile: views.
Sheet: full snapshot. Pure helpers for sum/rank so the UI is testable
without Graph.

Copy examples (lock in tests):

- `312.4k views across 14 posts`
- `3 live posts` stays the paste chip until views exist
- Unlinked copies do not count as zero — they count as **unknown**

### G4 — Suggestions (copy + button, no auto job)

Pure function on a pack + account recent medians. Examples:

- **Winner:** this source’s matched views ≥ 3× median of other sources
  (same workspace, last 7 days) **and** min floor (e.g. 10k views, tune
  from Jeff’s accounts). Button: **Generate 20 more of this original**.
- **Quiet original:** ≥ N copies linked, age ≥ 24h, **all** matched views
  below a quiet floor **and** the same account’s other recent media is
  not quiet. Copy: *These copies are not getting push. Try a new original
  — this may be the video, not the variant.* Never say “flagged.”
- **One dead copy among live siblings:** *This copy is quiet vs the rest of
  the pack.* Optional: mark Flagged stays a **human** action.

No uniqueness / VMAF / look change.

### G5 — Auto-amplify (later)

Workspace toggle off by default. If on: enqueue `regenerate` for G4
winners only, cap per day, skip in-flight sources. Still Fast uniqueness.
Still not a detector.

## Non-goals

- Native Instagram / TikTok / Shorts posting.
- Logging into Instagram as the VA; device farms; UI automation.
- A local “will this get flagged / pushed” model.
- Raising the 24-bit Fast gate because a winner “needs more uniqueness.”
- Pixel-AI / overlay scramble of the winning file.
- TikTok / YouTube analytics in G1–G4 (IG first; other platforms are a
  later Connect, same join on `post_url`).
- Putting tokens or Graph calls in the **CLI** FFmpeg path. This is Studio.
- Redis, Postgres, public Meta app for random signups. Invite-only Studio
  + test users until App Review.

## Invariants

- Color, zero-mean, VMAF, audio sync, 24-bit Fast gate unchanged.
- `platform_result` remains the policy oracle. Insights never write
  `flagged` / `duplicate_reject`.
- Unlabeled policy still = pass.
- Unmatched Insights media must not attach to the wrong variant.
- Lab vs Live: implement on Lab, promote Studio files with
  `scripts/promote-to-live.sh`. Do not git merge Lab ↔ Live.

## Success

An agency opens **Analytics** (and compact Gallery views), not Instagram
Insights, to answer: **which original is working, which copies are
carrying it, should we mint more or shoot something else.** Connect each
professional account (main/trial/growth). Numbers update without a
spreadsheet. Generate-more on a winner is the same Fast pack they already
trust.

## Frozen

24-bit Fast gate, VMAF on, Fast = CPU, HQ = GPU, unlabeled = pass,
invite-only, no Pixel-AI overlays, no account-proxy posting, no CLI Graph.
