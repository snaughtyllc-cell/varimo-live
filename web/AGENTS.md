<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Studio IA (read this before a redesign)

The product is **not** the v1 four-screen list (Studio / Gallery /
variant side-panel / Diagnostics). Those were the first tabs.

Live destinations, who sees them, and nested surfaces:
[`docs/ops/studio-ia.md`](../docs/ops/studio-ia.md)

Machine-readable catalog (test-locked to every `web/app/**/page.tsx`):
`web/lib/studioDestinations.ts`

Phone bar: Studio · Gallery · Drops · Flows · Drive.
Owner extras under More: Team · Analytics. Site-admin extras: Admin · Diagnostics.
VAs never see Analytics.
