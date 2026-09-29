# Direct-production Stage 4 operations

## Do not activate with placeholder configuration
Implementation acceptance and live-production acceptance are separate.
Do not relabel the Stage 3 staging descriptor or disable its production guards.
Do not merge main before the production acceptance and deployment-ownership
checks described in `STAGE4_PRODUCTION_CONTRACT.md`.

This workflow uses the existing production project. No separate staging
application is required. A temporary scratch Firestore database is used to
verify that the production backup can really be restored.

## Current repository and federation identity
The canonical repository is now `info-rbp/ProInspect-Platform` (repository ID `1390107826`, owner ID `235419395`). The production WIF condition must use this current repository name; conditions that still name `ProInspect-Booking-Portal-Application` will reject GitHub tokens after the rename.

The operator-created production pool is recorded as `proinspect-property-services` with provider ID `github`. Terraform and bootstrap adopt those explicit IDs instead of silently creating a second WIF pool.

The non-mutating `readiness` action intentionally requires only the three production environment variables: project ID, Terraform service-account email and full WIF provider resource. It does not require the unfinished production descriptor or `STAGE4_PRODUCTION_CONFIG_B64`. This allows keyless access to be proven before cloud inventory is used to complete the descriptor.

## One-time GitHub setup
In repository Settings > Environments, create `production`. Add a required
reviewer and custom deployment branch policies for `main` and
`release/platform-unification` only. Configure protection before adding secrets.
The connected code-editing tool cannot create these administration settings.

Environment variables:
| Name | Value |
|---|---|
| `GCP_PRODUCTION_PROJECT_ID` | `business-plan-applicatio-17047` |
| `GCP_TERRAFORM_SERVICE_ACCOUNT` | Actual account; provisioned example `proinspect-prod-terraform@business-plan-applicatio-17047.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Exact resource name printed by the keyless bootstrap |

Environment secrets:
| Name | Contents |
|---|---|
| `STAGE4_PRODUCTION_CONFIG_B64` | Base64 of the completed production descriptor; base64 is NOT encryption |
| `STAGE4_OPERATOR_RECEIPT_B64` | Only when required: base64 of the actual current freeze or acceptance receipt |

No personal Google password, OAuth session, production runtime JSON credential,
or permanent service-account JSON key is accepted by the production workflow.
Run the one-time WIF bootstrap in an already authorized Google Cloud Shell/local
session instead. Application payloads stay in Google Secret Manager.

A bootstrap CLI plan/apply is included:
```bash
python3 scripts/stage4/bootstrap.py \
  --config infrastructure/environments/production.local.json
# Review every account, project role, bucket and repository, then:
python3 scripts/stage4/bootstrap.py \
  --config infrastructure/environments/production.local.json \
  --approve EXACT_BOOTSTRAP_PLAN_DIGEST
```
Bootstrap creates or verifies supporting infrastructure only. Runtime, database
and Cloud Run service changes are reserved for the later reviewed phases.
The existing state bucket must be identified. New supporting buckets/repository
require `bootstrapCreateSupportingResources=true`; existing buckets must already
be private, uniform-access and versioned. Do not invent a replacement state owner.
Its broad infrastructure IAM grants need the same production-level review as
Terraform. Keep all grants inside the recorded production project.

## Production descriptor
Copy `infrastructure/environments/production.example.json` to the ignored
`production.local.json`. Fill every `REQUIRED_` value. The example contains the
repository's recorded production IDs, not a claim they were queried live.

Select the exact Stage 4 source SHA that passed normal CI and keep it unchanged
for this release; use `production-unification` or another explicit release ID.
The request and descriptor must contain the same source and release ID.
Set `stateOwnershipReviewed` only after actual Terraform ownership review.
Set `deploymentOwnershipReviewed` after reviewing all deployment mechanisms.

Important unknown inputs include the existing state bucket, actual Firestore
location, document bucket, build repository/source bucket, private evidence and
backup buckets, secret versions, and the controlled test mailbox/booking inputs.
The example intentionally cannot execute until these are supplied.

`production.imageRepository` must match the Terraform `artifact_repository_id`;
`production.evidenceBucket`, `backupBucket`, `buildSourceBucket` must match their
Terraform `operations_bucket_names` entries. The build/migration/deployment
accounts must match the `proinspect-prod-*` accounts adopted by Terraform.
Runtime remains the existing production runtime identity.

Retain the existing Firebase web app; do not create new production Auth users or
OAuth clients as a side effect of deploying the unified portal. Confirm Google
sign-in, email-link configuration and authorized domains for the current app.
The pipeline checks them; it does not overwrite the production OAuth secret.

Use enabled numeric Secret Manager versions. Required runtime values:
- the CURRENT `ACCESS_DATA_ENCRYPTION_KEY` (preserve bytes and key ID);
- `RESEND_API_KEY`;
- matching `REPORT_HANDOFF_SIGNING_KEY` and `REPORT_INGEST_TOKEN`;
- `PRODUCTION_RELEASE_TOKEN`, a separate random secret of at least 32 characters.
Optional Maps/payment bindings are only included when used. Payment checkout
must include its verified webhook binding. Never put secret payloads in the
descriptor or Terraform variables.

The new candidate-token container is created by Terraform as
`proinspect-production-release-token`. Add its value through Secret Manager
after the container exists and before the `candidate` action.
No automatic secret rotation occurs.

## Request mechanism
The workflow is `.github/workflows/stage4-production.yml`.
Before main is finalized, trigger it by editing and committing only
`ops/stage4-production-request.json` on `release/platform-unification`.
`workflow_dispatch` becomes available normally when this workflow is on main.
A request contains only:
```json
{
  "schemaVersion": 1,
  "action": "readiness",
  "releaseId": "production-unification",
  "sourceSha": "EXACT_40_CHARACTER_VERIFIED_STAGE4_SHA",
  "approve": ""
}
```
Do not use this illustrative SHA literally. Keep the same verified source while
committing subsequent requests. Request commits are not the deployment source.
A required reviewer approves the protected production job each time.

The controller runs with read-only GitHub repository permissions and cannot
merge main. Source/approval text is validated before it reaches shell commands.

## Actions and required evidence
| Action | Approval field | What it does |
|---|---|---|
| `disabled` | empty | No cloud operation |
| `readiness` | empty | Check real GitHub protection/configuration, exact-source CI and keyless GCP identity; no infrastructure apply |
| `plan` | empty | Inventory resources and encryption continuity; generate a saved Terraform plan |
| `build` | empty | Build immutable exact-source image, not a deployment |
| `maintenance` | `FREEZE:SOURCE_SHA` | Deploy/test minimal maintenance revision, then pause customer traffic and remove old revision tags |
| `backup` | empty; actual writer-freeze receipt required | Drain requests; make the frozen migration dry run; managed export and scratch restore verification |
| `infrastructure-apply` | saved infrastructure digest | Apply exactly the backed-up, reviewed, non-destructive infrastructure plan |
| `migration-apply` | saved migration digest | Atomically apply and immediately require a zero-write repeat |
| `candidate` | empty | Deploy guarded no-traffic application revision without startup seeding |
| `probe` | `TEST:REVISION` | Open token-only testing; run live integrations and create/manage/cancel a synthetic booking |
| `accept` | empty; actual acceptance receipt required | Verify real portal checks and frozen Report Tool round trip |
| `promote` | `PROMOTE:REVISION` | Require all evidence, change traffic, open public access and run post-release checks |
| `post-release` | empty | Recheck deployed production health/traffic |
| `contain` | `CONTAIN:REVISION` | Close candidate and return to maintenance; never rewind data |
| `rollback` | `ROLLBACK:REVISION` | Restore prior traffic only with recorded data-compatibility evidence |
| `close` | empty | Write actual `stage4-acceptance.json`; no main merge |

The `plan` and successful `backup` summaries display the exact approval digests.
Review the full saved private plan, not only its checksum. The workflow does not
publish plans/customer data to public GitHub artifacts.

Building is deliberately before maintenance: the same audited image contains
the maintenance server. Customer traffic is not changed by `build`.
The first production migration runs inside an acknowledged maintenance window.
Do not schedule it while customers need uninterrupted booking/portal access.

## Writer-freeze receipt
Pause external jobs, integrations and administrators that can write the database.
The app traffic alone is insufficient. For `backup`, `infrastructure-apply` and
`migration-apply`, put the current receipt in `STAGE4_OPERATOR_RECEIPT_B64`:
```json
{
  "projectId": "business-plan-applicatio-17047",
  "releaseId": "production-unification",
  "sourceSha": "ACTUAL_VERIFIED_SOURCE_SHA",
  "operatorPrincipal": "user:ACTUAL_OPERATOR_EMAIL",
  "externalWritersPaused": true,
  "evidenceReference": "Actual change record identifying paused writers",
  "completedAt": "ACTUAL_RECENT_UTC_TIMESTAMP"
}
```
This is an operator attestation, not a declaration the automation independently
paused all outside systems. The controller separately verifies the actual
maintenance traffic/tag isolation and waits for the previous request timeout
before generating the migration plan/export.

## Real production acceptance
The `probe` action performs only explicitly synthetic/test operations. Email is
sent to the controlled test mailbox; provider acceptance is not proof of inbox
delivery. Calendar test events are private/transparent and cleaned up.
Synthetic issued-report audit history is retained, not silently deleted.

While testing, use an authorized request-header client/proxy with the candidate
token to exercise portal pages. Public candidate URLs remain closed. The
separate Report Tool can authenticate at the exact candidate POST ingest
endpoint with its matching ingest token in testing; change its callback target
deliberately for the round trip, and restore the normal production endpoint
after promotion. This change is external to the portal repository.

Record real Client/Tenant/Admin sign-in and document-download checks, plus the
actual report handoff/finalized PDF. Replace the environment receipt with:
```json
{
  "operatorPrincipal": "user:ACTUAL_OPERATOR_EMAIL",
  "sourceSha": "ACTUAL_VERIFIED_SOURCE_SHA",
  "releaseId": "production-unification",
  "revision": "ACTUAL_CANDIDATE_REVISION",
  "completedAt": "ACTUAL_RECENT_UTC_TIMESTAMP",
  "evidenceReference": "Actual portal acceptance record",
  "checks": {
    "clientSignIn": "passed", "tenantSignIn": "passed",
    "adminSignIn": "passed", "documentDownload": "passed",
    "reportRoundTrip": "passed"
  },
  "priorRevisionCompatible": false,
  "rollbackEvidenceReference": "",
  "companion": {
    "schemaVersion": 1,
    "operatorPrincipal": "user:ACTUAL_OPERATOR_EMAIL",
    "deployedCompanionSha": "247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707",
    "reportToolUrl": "https://report.creation.proinspect.systems",
    "deploymentEvidenceReference": "Actual Cloudflare deployment record",
    "finalized": true,
    "reportSourceId": "ACTUAL_REPORT_ID",
    "propertyId": "ACTUAL_CANONICAL_PROPERTY_ID",
    "handoffAuditId": "ACTUAL_HANDOFF_AUDIT_ID",
    "issuedPdfSha256": "ACTUAL_PDF_SHA256",
    "completedAt": "ACTUAL_RECENT_UTC_TIMESTAMP"
  }
}
```
Keep `priorRevisionCompatible=false` until you have evidence of backward
compatibility with the migrated data. Without it, use `contain`, not a blind
traffic rollback to old code. No command automatically imports over live data.

## Interrupted operations and private evidence
Evidence is stored under `stage4/RELEASE_ID/SOURCE_SHA` in the private GCS
evidence bucket. Its manifest references checksummed immutable checkpoints.
A cross-release generation lock lives under `stage4/locks/DATABASE_ID.json`.
Do not delete that lock while an operation/runner is active. On a crash, inspect
Cloud Run traffic and the retained export/import IDs, reconcile the checkpoint,
then explicitly release the stale lock with a generation precondition.
Never retry a recorded export blindly. Scratch databases are retained for review.

Operational acceptance requires real data/revision/integration receipts.
`stage4-repository-acceptance` is explicitly code-test evidence only.

## Finalize main last
After `close` passes against the actual accepted revision, prepare one reviewed
release-branch merge to main. Confirm no competing Cloud Build/Cloudflare/other
trigger will automatically deploy a different image on that merge. The merged
application tree must match the tested release; run normal CI on the merge
commit. Do not sequentially merge the old Admin/Client/Tenant feature branches.
Keep the previously running revision and enabled compatible secret versions.

Public source references informing this design:
- https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration
- https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import
- https://docs.cloud.google.com/storage/docs/request-preconditions
- https://docs.github.com/en/rest/deployments/environments
- https://github.com/google-github-actions/auth
