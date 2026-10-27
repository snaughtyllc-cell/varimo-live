# HQ → Varimo → Postdesk contract

**Proposed implementation, NOT LIVE.** Branch `feat/postdesk-winner-destination`
in `snaughtyllc-cell/varimo-live`, based on production fedeaae. The separate
shortfall repair is excluded. No credentials, sharing, or deployment changed.
Jeff selected **B by default, A as manual fallback**. Both share one durable
operation per workspace + model + page + winner. Never change winner to retry.

## B: default server-to-server API

Proposed URL: `POST https://www.varimo.io/api/hq/jobs`.
Headers: `Authorization: Bearer <owner-configured-key>` and
`Content-Type: application/json`. HTTPS only in production.

HQ's proposed Railway variable is `VARIMO_API_KEY` (the owner-entered random
secret, at least 32 characters, ideally 32 random bytes encoded as hex).
Varimo's Railway variable is `VARIMO_HQ_API_KEYS_JSON`, a JSON array of grants:

```json
[{
  "sha256": "<64 lowercase hex characters: SHA256 of the exact key>",
  "scope": "varimo:jobs",
  "workspace_id": "<existing Varimo workspace ID>",
  "email": "<existing invited Varimo user email>",
  "models": ["GG"],
  "expires_at": 1800000000
}]
```

Those angle-bracket values are placeholders, not credentials. Owner installation
and expiry selection require separate activation approval. Generate/store the
raw key only through an approved secret-management flow; never paste it in chat.
Varimo stores its digest, not the raw key. The key authorizes only these HQ job
routes for the configured user/tenant and named models. It cannot sign in a
browser or call other Varimo APIs. No wildcard models, expired grants, duplicate
matching grants or auth-disabled installation are accepted. Removing a grant
revokes that key for subsequent requests. Existing tenant render quota applies.

Request (exact outer fields, count integer 1–40):

```json
{
  "target": {
    "source_file_id": "example_drive_file_id",
    "model": "GG",
    "page": "example-page",
    "winner": "trial-123"
  },
  "count": 20
}
```

Target has exactly those four fields. Source ID: 1–200 alphanumeric, `_` or `-`.
Other values: 1–120 characters, no leading/trailing whitespace, slash, backslash,
control characters, `.` or `..`. Names match exactly, including case.

HTTP 200 response:

```json
{
  "status": "accepted",
  "operation_id": "<64-hex ID>",
  "job_id": "<render job ID>",
  "status_url": "/api/hq/jobs/<operation_id>",
  "manual_url": "/studio?handoff=<operation_id>"
}
```

Accepted means a durable job exists (possibly queued), not finished or posted.
Identical retries return the existing job. Same operation with a different
source or count returns 409. One operation cannot move to another user.

`GET /api/hq/jobs/<operation_id>` uses the same Authorization header. It returns
operation_id, target, count, job_id, state, source_name, folder_id and exported.
For an existing job it also returns requested, rendered, drive_file_ids,
winner_folder_id and delivery_state (`pending`, `partial`, `complete`, or
`needs_review`). Render state is the existing job state; without a recoverable
job, state is `ready` or `needs_review`. Only `delivery_state=complete` establishes
all requested files have recorded delivery receipts. It does not prove that
Postdesk has posted them.

After a lost response, use read-only
`GET /api/hq/jobs/lookup?source_file_id=...&model=...&page=...&winner=...` (URL-encode
values) to find the operation without computing its ID. An identical POST is also
safe. A 404 lookup means no matching visible record; do not invent a new winner.

`POST /api/hq/jobs/<operation_id>/reconcile` resumes delivery of an existing,
finished job only; it never submits another render. Success is HTTP 200 with
`folder_id` and `exported`. Successful receipts are skipped. Uncertain upload
outcomes require operator reconciliation, not repeated blind uploads.

Errors use `{"detail":"..."}` where handled: 400 malformed target/count or
missing/ambiguous folder/source registration; 401 invalid, expired or missing key;
403 model outside scope or existing quota restriction; 404 unknown operation or
API disabled; 409 conflicting payload, uncertain submission/upload, or unfinished
render; 422 structural request validation. A 5xx, timeout, or connection loss is
**uncertain**, not proof that no job started: look up/retry the same operation.
Never automatically change payload, winner, account, or credentials on failure.

## A: manual fallback via existing SSO

HQ signs the existing HS256 JWT with `VARIMO_SSO_SECRET` as UTF-8 (not base64
decoded), and opens `https://www.varimo.io/sso/hq#t=<JWT>`. Browser removes the
fragment and exchanges it at POST `/api/auth/hq`; token remains only in memory.
Claims: `iss:"hq"`, `aud:"varimo"`, nonempty `sub`, existing invited `email`,
`role:"admin"|"partner"|"va"`, numeric `iat`, `exp`, unique `jti` (8–128
alphanumeric/underscore/hyphen characters); optional `name`, `nbf`, and the exact
`target` above. Use 60-second lifetime. Existing verifier allows 30 seconds clock
skew and at most 90 seconds exp-minus-iat. JTI is single-use. Role does not override
the user's stored tenant. No new SSO key is needed.

Target exchange returns HTTP 200 with `next:"/studio?handoff=<operation_id>"`;
ordinary SSO without target retains 204. Use the SAME email, model, page, winner,
and source as B. The page shows the existing job when B already submitted it;
it does not generate another pack. If no submission occurred, a human explicitly
clicks Generate. Default count20, selectable1–40. After an uncertain B submission,
state needs_review must be reconciled; A cannot bypass it. A's SSO target does not
include count; any existing B count remains immutable.

## Drive setup and source placement

In the intended tenant, register exactly one Drive destination named
`Postdesk: <model>` pointing to that model's `SOCIAL/POSTDESK` folder in haelomodels.
Share it with Varimo's configured identity, previously verified as
`studio@varimo.io`. Existing `<page>/To Post/Winners` folders must exist; duplicate
names fail. Winner child is created/resolved during delivery, never preview.

Source may be under that POSTDESK root OR under an explicitly registered
`Postdesk source: <model>` destination in the SAME tenant. The latter points to
the existing authorized source folder, shared with Varimo's identity; videos need
not move. Register multiple source roots with that exact model-specific name if
needed. Arbitrary files merely visible to the shared Drive identity are rejected.
This explicit source-root registration is an additional setup requirement beyond
the original brief. No live registration or sharing has been performed.

## Workflows, persistence and limits

Manual jobs retain their current output defaults. Normal workflows retain their
existing per-source layout. For a winner workflow, select the page's Winners
folder as OUT, set its winner ID and use one source per winner workflow. Empty
winner retains ordinary behavior. Jobs snapshot folder and winner before starting.
A durable workflow submission journal recovers the same job after an interruption
before its ledger write. Unrecoverable intent fails closed instead of rendering
again. Different workflow/HQ owners cannot claim the same winner folder.

Folder and upload intent is saved before each write, with returned Drive IDs
persisted afterward. Repeated/concurrent exports skip receipts. Ambiguous uploads
stop for operator review; no automatic rename or overwrite into watched folders.
Rendered files and journals depend on the existing persistent Varimo volume;
restore them together. Deleting journals or changing winner identities defeats
idempotency and is not a supported recovery procedure.

The referenced HQ design file was unavailable; implementation follows the supplied
brief plus Jeff's B-default/A-fallback decision. Tests use fake Drive/rendering.
No actual Postdesk posting, production API availability, or credential activation
is claimed. Activation still requires code review/deployment approval, owner key
configuration, tenant destination/source registration, and a separately authorized
live end-to-end test.

## Local verification

- Broader backend run: 588 passed (server suite plus Drive tests).
- Final affected run after recovery-review correction: 55 passed, including 22
  Postdesk cases covering concurrent A/B submission, lost B response followed by
  reconciliation and A fallback, workflow ledger interruption, store reload,
  conflicting payloads, expired/scoped credentials and uncertain uploads.
- Relevant frontend: 17 passed. Application TypeScript configuration passes.
- Full test-fixture TypeScript configuration has the same 85 error locations as
  the baseline checkout, with no feature-only error locations.
- The existing SSO signature-tail test is nondeterministic: unchanged production
  code and this branch both accept an alternate base64 encoding of identical
  signature bytes. The latest broader run passed; earlier runs exposed that
  baseline issue. This change does not alter signature verification.
