# Postdesk winner destinations (local implementation)

This implementation chooses brief option (a): the existing HS256 HQ sign-in token
may contain `target: {source_file_id, model, page, winner}`. Existing expiry,
issuer, audience and signature validation still apply. HQ keeps the token in the
URL fragment as before. Token exchange returns a local Studio review URL for a
target; ordinary sign-in keeps its existing 204 response. Opening the link does
not render or upload. A human must click **Generate and send to Postdesk**.
Unattended HQ submission requires option (b), a separate scoped server-to-server
integration; no such key is created or configured by this change.

## Setup and contract

In the intended Varimo tenant, register exactly one Drive destination named
`Postdesk: <model>` whose folder ID is that model's `SOCIAL/POSTDESK` folder in
haelomodels. The owner must share that folder with Varimo's configured Drive
identity (`studio@varimo.io` in the current deployment). This document does not
perform sharing or change live destinations. Existing `<page>/To Post/Winners`
folders must already exist and names must match exactly. Ambiguous names fail.
The winner child is created only during delivery, never during preview.

The source video must be underneath the same registered model POSTDESK root.
This bounds access to the current tenant despite the shared Drive identity. HQ
must supply a source in that tree; arbitrary shared-account file IDs are rejected.
A signed handoff belongs to its signed-in user and home tenant. A winner cannot
be silently rebound to another source or workflow. A repeated Generate click
returns the same job. Persisted submission ambiguity fails closed for review.

## Workflows and defaults

Normal manual jobs and workflows retain their existing output behavior. Workflow
output destination remains selectable. For an opted-in winner workflow, select
the page's Winners folder as OUT and provide its trial winner ID. Use one source
per winner workflow. Leaving winner blank preserves the old per-source layout.
Jobs snapshot output folder and winner before starting, so editing a workflow
does not reroute an in-flight job. Metadata survives stored-job hydration.

## Delivery and recovery

Approved variants are delivered under `<Winners>/<winner>/`, using stable
source/index filenames. Each job journals folder/upload intent and returned Drive
IDs on persistent disk. Concurrent/repeated exports reuse successful receipts.
An upload with an uncertain outcome is not blindly repeated: an operator must
reconcile its receipt against Drive before retry. No automatic rename or duplicate
posting is used to hide uncertainty. Finished HQ jobs expose **Check or resume
delivery**; workflow harvesting also resumes safe delivery. Existing successful
receipts are skipped. Different content under an already delivered filename is
held for review. This favors avoiding duplicate posts over automatic recovery
from every possible interruption.

## Scope and validation

Repository: snaughtyllc-cell/varimo-live. Branch: feat/postdesk-winner-destination,
based on fedeaae, excluding the separate shortfall-repair patch. Referenced HQ
spec `docs/superpowers/specs/2026-10-27-hq-seamless-workspace-design.md` was not
available in this checkout; the supplied brief is the implemented contract.
Tests use fake Drive and rendering; they do not establish live Postdesk posting.
No keys, infrastructure, sharing, live folders, or deployments were changed.
