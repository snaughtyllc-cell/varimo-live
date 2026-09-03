# Instagram testers (Connect for Insights)

Invite-only Studio uses a **testers-only** Meta app. No App Review for
operators Jeff onboarded. Insights are not a detector — `platform_result`
stays the human oracle.

## One-time per @handle

1. **Meta App Dashboard** → App roles → Roles → add **Instagram Tester**
   (`@handle`, not email). Repeat for main / trial / growth accounts.
2. On Instagram: Settings → Apps and websites → **Tester invites** →
   accept. Pending invites cannot Connect.
3. Account must be **Professional** (Business or Creator).
4. In Studio: **Analytics** or **Drive** → **Connect Instagram**
   (workspace owners and site admins only — VAs do not see Analytics).
   OAuth callback lands on `/analytics?ig=connected`.

Each Connect **adds** that @handle. It never replaces other connected
accounts in the workspace.

## Tokens

- Primary path: OAuth callback stores a long-lived token at
  `{workspace}/instagram/account_{user_id}.json` (one file per tester).
- Fallback: paste token flow if OAuth is blocked (same storage shape).

## Env (Jeff / Railway)

See `deploy/railway/studio.env.example`:

- `VARIANT_IG_APP_ID`
- `VARIANT_IG_APP_SECRET`
- `VARIANT_IG_REDIRECT_URI` (default `{origin}/api/instagram/oauth/callback`)

Drive Google OAuth stays one shared mailbox (site-admin Connect). Instagram
is many tester accounts per workspace.

## Matched 0

Connect working and Sync saying **matched 0** are different:

- **Graph sent 0 Reels** — tester invite not accepted, not Professional, or
  the token listed the wrong id. Studio now tries `/me/media` then
  `/{IG_ID}/media`.
- **Graph sent Reels, auto-link missed** — caption matching is a unique-on-
  that-account hint. Banks reuse lines; VAs edit on the phone. Unmatched
  Reels get a picker on Analytics. Identity after that is `ig_media_id`.
  Send-to-Drive bank lines were only on the Drive filename; Sync now reads
  those export names when Gallery `caption` is empty.

Unlinked is **unknown**, not 0 views.

Spec: `docs/superpowers/specs/2026-09-02-instagram-insights-gallery.md`.
