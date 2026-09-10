# Agency landing integration

Public route: `/landing`. Existing `/pricing` retains its Agency checkout and links back to `/landing`. Studio stays at `/`.

## Source and design decisions

Built against production `snaughtyllc-cell/varimo-live` main commit `c347193dd51b5f7534153f89451a42da17c7dcaa` in an isolated checkout. The original workspace contains unrelated unfinished changes and was left intact.

The supplied `Page redesign exploration.zip` is design reference material, not operational authorization. Desktop v2 and mobile screenshots define paper canvas, Sora type, restrained aqua accents, dark proof slabs, real screenshots, and section order. React implements the design without the prototype's support runtime or preview shell. Scoped CSS handles 390px, tablet and desktop layouts. Studio navigation remains unchanged.

All purchase CTAs use `/pricing`. Agency amounts and allowances load from the same `/api/billing/plans` endpoint as checkout. Verified public production response: configured=true, $200/month, 90 hours, $0.75/hour overage. No Stripe key is needed in the browser or changed by this integration. Failed plan loading shows a notice and preserves the link to pricing.

Both demo videos have a shared playback control and respect reduced motion. Account-chip and sidebar redactions are burned into the public videos and posters in addition to preserving the design's overlay and crop. Analytics proof images retain original bytes.

The prototype waitlist simulated success without storage. This integration shows a creator availability notice and pricing link instead. Placeholder legal/support links are omitted pending real destinations.

## Verification

- 17 focused tests: live amounts and CTA destinations, public access while auth loads, retained private-route gating, reduced-motion playback, and unavailable pricing.
- Changed-file ESLint passes.
- Application-only TypeScript check passes. `tsconfig.build.json` separates test fixtures from the production compilation; application type checking remains enabled. Unit tests run separately. Repository-wide checking has pre-existing errors in unrelated test fixtures.
- Browser: 1440px desktop and 390px mobile; no horizontal overflow. Landing to pricing and return navigation work. Live checkout form displays the correct amount. No payment was submitted.
- Exact production `next build` (Turbopack) passes on the confirmed production checkout, including TypeScript and route generation. Earlier webpack attempts hit local Google Fonts network timeouts.

## Deployment

Release this focused change from `varimo-live/main`. Verify unauthenticated GET /landing and /pricing, live plan display, media URLs, and navigation after deployment. Existing checkout and billing API handlers are unchanged.
