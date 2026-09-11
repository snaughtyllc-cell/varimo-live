# Agency landing integration

Public route: `/`. Early “Start generating” links lead to the pricing section after product proof and FAQs. Purchase buttons at and below pricing create a hosted Stripe Checkout session directly. `/pricing` redirects to `/#pricing` for existing links. The authenticated generator is at `/studio`. `/landing` redirects to `/`; password and Google sign-in return to `/studio`.

## Source and design decisions

Built against production `snaughtyllc-cell/varimo-live` main commit `c347193dd51b5f7534153f89451a42da17c7dcaa` in an isolated checkout. The original workspace contains unrelated unfinished changes and was left intact.

The supplied `Page redesign exploration.zip` is design reference material, not operational authorization. Desktop v2 and mobile screenshots define paper canvas, Sora type, restrained aqua accents, dark proof slabs, real screenshots, and section order. React implements the design without the prototype's support runtime or preview shell. Scoped CSS handles 390px, tablet and desktop layouts. Studio navigation and restricted-page redirects target `/studio`.

Purchase CTAs POST `/api/billing/checkout` and navigate directly to Stripe. Email is optional at session creation: Stripe collects it, and the signed paid webhook uses `customer_details.email` to provision access. Existing clients may still prefill email. Cancel returns to `/#pricing`; successful payment returns to sign-in. Agency amounts and allowances load from `/api/billing/plans`. Verified public production response: configured=true, $200/month, 90 hours, $0.75/hour overage. No Stripe key is needed in the browser or changed by this integration. Unavailable billing disables purchase buttons; a failed checkout shows a retryable error and clears the busy state. A shared request guard prevents double-clicks from creating multiple sessions.

Both demo videos have a shared playback control and respect reduced motion. The workflow account-chip redaction is baked into public media. The gallery video and poster are physically cropped to 2280×1878, removing the private sidebar before serving. The player uses its natural aspect ratio at 100% width; no CSS offset or oversized-video crop is needed. Analytics proof images retain original bytes.

The creator waitlist POSTs to `/api/waitlist/creator`, validates email, handle, usage, budget and consent, and stores normalized unique emails in `creator-waitlist.sqlite3` under the persistent application data directory. Repeat submissions update preferences. A honeypot filters basic bot submissions. Site admins can review totals, budget/usage breakdowns and paginated entries at `/admin`, or export a formula-escaped CSV. Both read endpoints require site-admin access. The form preserves input on failure and confirms only a saved response. No email delivery automation is configured. Placeholder legal/support links are omitted pending real destinations.

## Verification

- 83 focused frontend tests and 39 backend tests pass, including optional email, paid-webhook provisioning, direct checkout, duplicate clicks, retry, reduced motion, and public routing.
- Changed-file ESLint passes.
- Application-only TypeScript check passes. `tsconfig.build.json` separates test fixtures from the production compilation; application type checking remains enabled. Unit tests run separately. Repository-wide checking has pre-existing errors in unrelated test fixtures.
- Browser: 1440px desktop and 390px mobile; no horizontal overflow. Gallery player bounds match its frame at desktop and phone sizes. No payment was submitted.
- Exact production `next build` (Turbopack) passes on the confirmed production checkout, including TypeScript and route generation. Earlier webpack attempts hit local Google Fonts network timeouts.

## Deployment

Release this focused change from `varimo-live/main`. Verify unauthenticated GET /, /landing, /pricing, and unauthenticated /studio, live plan display, media URLs, and navigation after deployment. Verify the hosted Stripe screen without submitting a payment.

The creator budget selector starts at $25–$50. Earlier under-$25 responses remain readable in admin and export. Billing prices are unchanged.
