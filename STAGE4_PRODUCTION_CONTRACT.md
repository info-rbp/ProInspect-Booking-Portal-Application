# Stage 4 - Direct-production release contract

## Decision and current meaning
The owner chose to skip a separate staging portal/project. That is a changed
release policy, not evidence that Stage 3 live staging passed. Stage 3 remains
production-write-locked. Stage 4 has its own controller, production descriptor,
workflow, exact-source approvals, maintenance boundary and acceptance record.

Repository acceptance means the permanent `Verify booking portal` workflow
passes at the exact source containing this contract. It does not mean Google
Cloud, GitHub environment settings, WIF, customer data or production traffic have
been changed. A successful disabled/readiness workflow is not a deployment.

The frozen production targets are:
- project `business-plan-applicatio-17047`;
- database `ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a`;
- Cloud Run `proinspect-booking-portal-application` in `europe-west1`;
- application `https://bookings.proinspect.systems`;
- production main baseline `6a55131f5890b82047d8b78d2af2bdc6f140041f`;
- state prefix `booking-portal/production`.
Actual state/bucket names and database location are required inputs, not guesses.

## Production access and prerequisites
Create a real GitHub `production` environment with a reviewer and explicit
`main` / `release/platform-unification` branch policies. The workflow reads the
actual environment protection settings through the GitHub API: a marker
variable is not treated as an approval gate. It has no repository write
permission and cannot merge main. Live jobs use OIDC/WIF only, not a permanently
stored Google service-account JSON key.

The one-time `scripts/stage4/bootstrap.py` is run in an authorized Cloud Shell or
local Google CLI session. It prints a supporting-resource/IAM/federation plan
and makes changes only when its exact digest is approved. It leaves the running
Cloud Run application and customer data untouched. It is not a substitute for
reviewing existing state ownership. New supporting buckets/repository are only
created when explicitly permitted in the descriptor. Existing resources retain
their names and are adopted by the subsequent reviewed Terraform plan.

Bootstrap needs permissions to create/manage the listed identities, IAM,
private buckets, build repository and WIF in this one project. It does not
grant itself project Owner or attach a billing account. Terraform necessarily
has infrastructure-management authority; production environment and branch
review are essential protections around that authority.

Service-account names use `proinspect-prod-*` (the longer proposed
`proinspect-production-terraform` and `...-migration` exceed Google's 30-character
service-account ID limit). Runtime identity remains the existing
`proinspect-booking-runtime@business-plan-applicatio-17047.iam.gserviceaccount.com`.

## Cutover sequence and planned outage
The initial direct-production cutover has a deliberate maintenance window.
A no-traffic Cloud Run revision does NOT isolate it from the production database.
A tag on a public Cloud Run service is not automatically private.

The sequence is:
1. Verify the exact release source and completed production descriptor.
2. Inventory production, validate secret/key continuity, review state ownership,
   and exclude competing deployment triggers.
3. Create a saved non-destructive Terraform plan.
4. Build the exact image before maintenance, preserving the existing Firebase
   browser app. This ordering is intentional: the audited image also contains
   the maintenance server; building it does not change customer traffic.
5. On `FREEZE:<sourceSha>` approval, deploy the minimal maintenance server with
   no traffic, check it, then move traffic to it and remove old revision tags.
6. Confirm external/background writers are paused, drain in-flight requests,
   make the migration dry run, export the real database and verify a scratch
   restore in the same production project. This scratch database is for recovery
   verification, not a separate staging application.
7. Apply only the saved approved infrastructure plan.
8. Apply only the approved production migration plan atomically; immediately
   repeat the migration and require zero further writes.
9. Deploy the guarded application candidate without customer traffic or startup
   seeding. Explicit source, release, revision and encryption continuity checks
   must pass.
10. Open only token-authenticated testing; exercise live integrations and a
    clearly synthetic booking addressed to the controlled test mailbox.
11. Record real Client, Tenant, Admin and document checks, and verify an actual
    frozen Report Tool handoff/issued-PDF round trip.
12. On `PROMOTE:<revision>` approval, route traffic to the accepted revision,
    open its public release gate, and run post-release checks.
13. Write private `stage4-acceptance.json` only after all checks agree.

The maintenance server returns HTTP 503 for application/booking routes. It loads
no Firebase, Calendar, email, storage or seeding code. An old tagged revision
must not remain available as an alternate writer. The external-writer pause is
explicitly operator-attested; this controller cannot pause every administrator,
third-party integration or background system.

The candidate is protected before body parsers/handlers by
`productionReleaseGate`. The exact release's `_releaseControl/active` record
must be `testing` plus a valid test token, or `live`. A correctly authenticated
Report Tool may use only the exact POST ingest endpoint in testing. Missing
state or failed reads close the gate. Initialisation cannot seed data while
`PRODUCTION_RELEASE_ID` is present.

## Data integrity, recovery and limits
The Stage 3 CLI's production apply prohibition remains intact. Only the separate
Stage 4 entry point can invoke the shared atomic writer with a validated
production cutover permit. The permit is bound to the exact target, source,
config file, migration digest, successful managed export, verified restore,
maintenance revision and external-write-freeze attestation. It rechecks live
Cloud Run traffic/tags and the actual export operation immediately before the
database transaction.

The migration's deliberate limits remain 20,000 scoped source documents,
400 changed documents and 7 MiB of serialized changes. Larger/ambiguous datasets
stop. There is no unreviewed partial batching fallback.

Managed export includes the database. Hash/count reconciliation and restore
verification cover the declared migration collections, not every unknown
collection or subcollection. A completed export alone is not accepted as proof
of recoverability. Scratch restore databases and immutable synthetic report
history are retained for inspection. No recovery imports over the active
database automatically.

Existing encryption key material and key ID are preserved. Replacing or rotating
encryption keys is explicitly outside this release. Runtime secret values stay
in Secret Manager; GitHub receives only configuration, IDs and pinned numeric
versions. Candidate access uses the separate
`proinspect-production-release-token` secret, not a personal Google credential.

## Deployment and rollback
The existing Cloud Run service's IAM policy remains unchanged. Terraform does
not own its service/revision definition. Deployment and maintenance traffic
changes are checked against a captured baseline. Existing Firebase app,
database, bucket locations, public origin and runtime identity are not replaced.

Failed post-promotion checks close the release gate and return to the maintenance
revision. `contain` provides the same explicit emergency containment later.
The prior production revision/allocation is retained. `rollback` may restore
that allocation only with recorded evidence that the old application can safely
operate against the migrated data. Traffic rollback does not roll back data.
Never assert that a Cloud Run revision switch reverses a migration.

Real OAuth logins and the separate Cloudflare deployment are operator-attested
with evidence references; actual canonical handoff, PDF content/hash and report
publication are verified by the receipt command. Configuration checks and
synthetic ingest tests do not substitute for these real user journeys.

## Checkpoints and main finalization
Operational checkpoints are private, source/config-bound, checksummed objects
in the reviewed GCS evidence bucket. Generation-precondition locks prevent
concurrent releases; caches, credentials, runner config, logs and permits are
not synchronized. Lost/corrupt checkpoints and persistence failures stop the
release rather than falsely marking success.

Each checkpoint used for acceptance must be recent (24 hours unless explicitly
specified otherwise). An interrupted managed operation retains its real ID.
Inspect it before repeating any export/import. A crashed lock is not cleared
automatically; examine production traffic and running operations first.

After actual production acceptance, finalize a single reviewed release-branch
merge to main with the same accepted application tree. Inventory/disable
competing main deployment triggers FIRST so this merge cannot cause an untested
second deployment. The production workflow deliberately cannot perform that
merge; it is a distinct authorized repository operation. Do not merge on the
basis of code-only CI, skipped staging results, or a disabled request.

See `docs/STAGE4_PRODUCTION_RUNBOOK.md` for exact configuration and actions.
