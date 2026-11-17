# Operator-issued password recovery

There is no public email-send endpoint. An authorized operator issues a recovery
link only for an existing verified user. Do not blank password hashes, create a
replacement account, or change workspace membership.

## Properties

- 256-bit random bearer token; only SHA-256 digest stored on the auth volume.
- One-hour expiry, one use, reissue replaces older token. Changing the password
  independently invalidates any outstanding token.
- Atomic consume and password update under thread + advisory filesystem locks.
  The current service is a single process; all operator access must use TenantStore,
  not direct JSON edits. Filesystem must support `flock` (Linux/macOS).
- New login cookies bind to the verified credential version (HMAC of the stored
  password hash). A login racing a reset cannot turn old credentials into a
  post-reset session.
- Successful recovery revokes the target's older cookie sessions; other users are
  unaffected. Legacy cookies without issue time are rejected only for users who
  have recovered. Recovery does not automatically sign the user in.
- Fragment token is not sent in GET request paths or Referer headers. Form removes
  the fragment from browser history immediately. It has no third-party assets,
  uses CSP/no-store/no-referrer, and posts JSON to the same origin.
- No validation errors echo credentials. Recovery is throttled to ten attempts
  per minute globally per service process. This is deliberately conservative for
  operator-assisted use. A general public recovery service needs shared throttling
  and an authenticated email-delivery provider before expanding this flow.

Use the canonical `https://www.varimo.io` origin. The apex host currently redirects
API paths to the homepage and cannot be used for recovery links.

## Release / issue / verify

1. Run tests; inspect production queue and defer deployment while jobs are active.
2. Deploy through the normal reviewed PR path. Verify the public form without any
   real token. Do not mint production recovery links as smoke tests.
3. Confirm the user's exact account and approved delivery destination. A reset
   link grants account access: do not put it in chat, tickets, screenshots, or logs
   without the required action-time approval.
4. On the production host, from the app root, run:

   `PYTHONPATH=. python scripts/issue_password_reset.py --store /data/vmdata/auth/tenants.json --email VERIFIED_EMAIL --output /tmp/recovery-private.txt`

   Output is a new file with mode 0600; the command prints no token. Read/transfer
   it only through the approved secure delivery flow. Do not cat it into tool logs.
5. Recipient opens the link, chooses and confirms their password, then signs in
   normally. Existing password stays unchanged until successful redemption.
6. Verify only sanitized status: token record gone, account workspace/role unchanged,
   and recipient confirms sign-in. Remove the transient private link file after
   delivery/expiry under applicable deletion permission. Reissue if expired.

Do not issue until ready to deliver: issuing invalidates any previously issued link.
