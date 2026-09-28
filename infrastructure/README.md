# Unified ProInspect infrastructure and staging operations

The Stage 3 implementation and acceptance boundaries are defined in
[`STAGE3_INFRASTRUCTURE_CONTRACT.md`](../STAGE3_INFRASTRUCTURE_CONTRACT.md).
This directory preserves the frozen Client Terraform addresses while extending
them for the combined Admin, Client and Tenant platform.

**Do not reuse the old Client `cloudbuild.infrastructure.yaml` production apply
pipeline.** It is not part of this release branch. Infrastructure planning,
reviewed application, build, deployment and data migration are separate actions.
There is no default production target and no Stage 3 production apply command.

## Inputs and ownership

Start from `environments/staging.example.json`, save an ignored
`environments/staging.local.json`, and replace every placeholder with a verified
value. Use a separate billed Google Cloud project, a dedicated staging Calendar,
isolated Report Tool deployment and test mailbox. The existing production values
in `environments/production.tfvars.reference` are inventory reference only, not
an executable production apply configuration.

The operator needs permission to perform initial bootstrap in the selected
staging project. Bootstrap enables prerequisite APIs, creates identities and a
private versioned state bucket, grants the Terraform identity its infrastructure
management roles and grants the named operator impersonation. It checks that the
project is active and billing is enabled; it does not create a project or attach
an unknown billing account.

Terraform state ownership must be explicitly reviewed. Set
`stateOwnershipReviewed=true` only after establishing which existing objects are
unmanaged or already in this state. Inventory generates matching imports for
existing APIs, identities, buckets, secret containers, database, Firebase app,
indexes, backups, rules release and federation resources. Use the `imports` map
for reviewed exceptions. Never import one physical resource into two states.
All production planning must retain the existing state prefix; a new staging
project must not reuse production state, identities, buckets, Calendar or keys.

## Offline verification

Use Node 22.16, Java 21, Python 3.12+ and Terraform 1.10.5. From the repo root:

```bash
npm ci
npm run lint
npm run freeze:check
npm run stage2:check
npm run stage3:check
npm run stage3:test:controls
terraform fmt -check -recursive infrastructure
terraform -chdir=infrastructure init -backend=false -input=false -lockfile=readonly
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure test
npx --yes firebase-tools@14.2.1 emulators:exec --only firestore \
  --project demo-stage3-atomic --config firebase.ci.json \
  'npm run stage3:test'
npm run build
```

Mocked Terraform tests use no credentials and create no cloud resources. The
normal GitHub workflow also checks the original migration preflight, performs the
runtime dependency audit and builds the production container. Do not interpret
emulator tests as a completed live staging deployment.

## GitHub live-staging automation

The repository includes a protected push-triggered workflow at
`.github/workflows/stage3-live-staging.yml`. It deliberately does **not** use
`workflow_dispatch` because this release workflow is not on the default branch.
Instead, an authorized maintainer changes only
`ops/stage3-live-request.json`; pushes affecting that file on
`release/platform-unification` trigger the live-staging workflow. The request
contains no credentials.

Before enabling it, create a GitHub environment named `staging`, restrict it to
`release/platform-unification`, and configure a required reviewer. Add these
environment variables:

- `STAGE3_ENVIRONMENT_GUARD=PROTECTED_STAGING`
- `GCP_STAGING_PROJECT_ID=<dedicated staging project ID>`
- `GCP_TERRAFORM_SERVICE_ACCOUNT=<staging Terraform service-account email>`
- after the first reviewed Terraform apply,
  `GCP_WORKLOAD_IDENTITY_PROVIDER=<provider resource name emitted by Terraform>`

Add `STAGE3_STAGING_CONFIG_B64` as an environment secret. It is the base64
encoding of the completed ignored `staging.local.json`; the workflow decodes
it only on the runner and never commits it. Application secret payloads remain
in Google Secret Manager, not GitHub.

### First-run authentication

The preferred steady state is GitHub OIDC + Google Workload Identity Federation.
No Google service-account key is required after federation exists. The Terraform
configuration binds the constrained staging GitHub provider to the staging
Terraform identity, and that identity may impersonate only the stage-specific
runtime/build/deploy/migration/gateway accounts needed by the control plane.

There is an intentional bootstrap problem on the first run: Terraform cannot
create the Workload Identity Provider until GitHub can authenticate to apply the
Terraform plan. For that first `bootstrap-plan` and `apply` only, the workflow
accepts the environment secret `GCP_BOOTSTRAP_CREDENTIALS_JSON`. This must be a
dedicated **staging-only service-account key**, never personal Google credentials
and never a production service-account key. Set the descriptor's top-level
`operatorPrincipal` to `serviceAccount:<bootstrap service account email>`.
The bootstrap identity must have the staging-project permissions needed by
`control.py bootstrap`.

Immediately after the reviewed apply creates Workload Identity Federation:

1. copy the emitted provider resource name into the environment variable
   `GCP_WORKLOAD_IDENTITY_PROVIDER`;
2. verify the next `status` request authenticates keylessly;
3. delete `GCP_BOOTSTRAP_CREDENTIALS_JSON` from GitHub; and
4. disable/delete that Google service-account key.

The workflow refuses to use the bootstrap JSON for later auth, migration,
deployment, acceptance, promotion or rollback actions.

### Request actions

`ops/stage3-live-request.json` supports the following staged actions:
`status`, `bootstrap-plan`, `apply`, `auth`, `migration-plan`,
`migration-apply`, `deploy`, `record-companion`, `close`, `promote`
and `rollback`. `disabled` performs no cloud action.

The `sourceSha` must be an ancestor of the request commit and must already have
a successful permanent **Verify booking portal** run. The workflow checks out
that exact SHA rather than deploying the request commit itself. Infrastructure
and migration plan digests and staging revisions are passed through the
non-secret `approve` field; the workflow rechecks them before mutation.

Private plans and evidence are never uploaded as public GitHub artifacts. They
are synchronised under `stage3-live-private/<sourceSha>` in the private,
versioned staging Terraform-state bucket so successive protected requests can
continue the same rehearsal.

For the real Report Tool round trip, base64-encode the private companion receipt
into the temporary environment secret `STAGE3_REPORT_COMPANION_RECEIPT_B64`,
run `record-companion`, then remove that secret.

## Reviewed staging sequence

Run from a clean committed checkout whose exact SHA passed normal CI. Export no
service-account JSON keys. Commands use the descriptor's named identities via
impersonation. Define the path, substituting the verified project ID when an
approval is required:

```bash
CONFIG=infrastructure/environments/staging.local.json
python3 scripts/stage3/control.py validate-config --config "$CONFIG"
python3 scripts/stage3/control.py bootstrap --config "$CONFIG" --approve STAGING_PROJECT_ID
python3 scripts/stage3/control.py inventory --config "$CONFIG"
python3 scripts/stage3/control.py plan --config "$CONFIG"
# Review the private plan, imports and approval digest, then:
python3 scripts/stage3/control.py apply --config "$CONFIG" --approve EXACT_PLAN_DIGEST
```

The private workspace is
`private-evidence/stage3/staging/PROJECT_ID/DATABASE_ID/`. Plans and snapshots may
contain private data; files are restricted to owner access and excluded from Git
and Docker contexts. Protect this directory and the versioned state/backup buckets.

Add required Secret Manager versions **out of band**, using protected files or
stdin, not Terraform or command arguments containing the value. Set their numeric
versions in the descriptor: `ACCESS_DATA_ENCRYPTION_KEY`, `RESEND_API_KEY`,
`REPORT_HANDOFF_SIGNING_KEY`, `REPORT_INGEST_TOKEN`; add optional Maps/payment
versions only when used. Supply the configuration-only Google sign-in OAuth
secret/client ID separately. After editing a descriptor, regenerate/review the
infrastructure plan; its digest is bound to all configuration inputs.

```bash
python3 scripts/stage3/auth.py --config "$CONFIG" --approve STAGING_PROJECT_ID
```

The OAuth client must already exist with the appropriate Firebase redirect URI,
consent settings and test users. Share the dedicated Calendar with the runtime
service-account email with event-management access. Configure the Report Tool's
isolated D1/R2/Access deployment and matching handoff/ingest secrets; do not change
its production deployment. Encryption-key replacement without ciphertext
migration is prohibited; retain compatible keys and secret versions.

Load a representative de-identified staging dataset through an approved data
preparation process. No command automatically copies production customer data.
Quiesce all writers, then rehearse:

```bash
python3 scripts/stage3/rehearse.py dry-run --config "$CONFIG"
python3 scripts/stage3/rehearse.py backup --config "$CONFIG" --approve STAGING_PROJECT_ID
python3 scripts/stage3/rehearse.py restore-check --config "$CONFIG" --approve STAGING_PROJECT_ID
python3 scripts/stage3/rehearse.py apply --config "$CONFIG" --approve EXACT_MIGRATION_PLAN_DIGEST
python3 scripts/stage3/rehearse.py repeat --config "$CONFIG"
```

The managed export must finish successfully; restore must reproduce scoped
content/counts in a new scratch database; apply must match the original dry run;
repeat must propose zero writes. Source drift, missing references, ambiguous
identities, invalid plan dates and size limits stop the process. Scratch databases
and synthetic issued-report records are deliberately retained for review, not
silently deleted. Managed export includes all data, while fingerprint validation
covers the declared migration collection scope only.

Build and deploy a private staging candidate, then its narrow report gateway:

```bash
python3 scripts/stage3/deploy.py build --config "$CONFIG"
python3 scripts/stage3/deploy.py candidate --config "$CONFIG"
python3 scripts/stage3/deploy.py gateway --config "$CONFIG" --approve STAGING_PROJECT_ID
node --import tsx scripts/stage3/integrations.ts --config "$CONFIG" --approve STAGING_PROJECT_ID
python3 scripts/stage3/deploy.py booking-test --config "$CONFIG" --approve STAGING_PROJECT_ID
```

Configure the isolated Report Tool's ingest endpoint to the gateway URL emitted
by `gateway`, ending in `/api/integrations/reports`. Do not point it directly at
the private core service. The public gateway receives only the pinned ingest
secret and an identity with invocation permission; the core validates canonical
relationships and the same integration token. Its deployment cannot replace an
unrelated existing service. Portal entry points remain private in staging.

The integration probe sends a test email and creates/deletes transient test
objects and a private transparent Calendar event. The booking smoke creates,
reads and cancels a synthetic booking and verifies email-provider acceptance.
Set actual test address/phone/service inputs in `bookingTest`. No real customer
mailbox should be used. API acceptance does not guarantee inbox delivery.

## Separate Report Tool acceptance

Perform a real authenticated Admin handoff to the isolated Report Tool, finalize
the report there, and confirm the companion's deployed SHA from its deployment
record. Create a private receipt containing:

```json
{
  "schemaVersion": 1,
  "operatorPrincipal": "user:OPERATOR_EMAIL",
  "deployedCompanionSha": "247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707",
  "reportToolUrl": "https://ISOLATED_REPORT_TOOL_HOST",
  "deploymentEvidenceReference": "Cloudflare deployment record identifier",
  "finalized": true,
  "reportSourceId": "ACTUAL_REPORT_TOOL_REPORT_ID",
  "propertyId": "CANONICAL_PROPERTY_ID",
  "handoffAuditId": "ACTUAL_STAFF_HANDOFF_AUDIT_ID",
  "issuedPdfSha256": "SHA256_OF_ACTUAL_FINALISED_COMPANION_PDF",
  "completedAt": "ACTUAL_RECENT_UTC_TIMESTAMP"
}
```

```bash
node --import tsx scripts/stage3/record-companion.ts \
  --config "$CONFIG" --receipt private-evidence/companion-receipt.json \
  --approve STAGING_PROJECT_ID
python3 scripts/stage3/control.py close --config "$CONFIG"
python3 scripts/stage3/deploy.py promote --config "$CONFIG" --approve EXACT_STAGING_REVISION
```

Receipt verification reads canonical records and actual stored PDF bytes. The
Cloudflare deployment SHA remains explicitly operator-attested; the command does
not pretend to query Cloudflare. Missing/old/wrong-target evidence prevents
closure. A synthetic ingest probe cannot substitute for this companion round trip.

## Recovery and production boundary

Before staging promotion, the previous application's traffic remains unchanged.
After promotion, `deploy.py rollback --config "$CONFIG" --approve
EXACT_STAGING_REVISION` restores the saved previous traffic allocation. A first
service has no prior revision: rollback stops rather than deleting it. Data
recovery never automatically imports over the application database; inspect the
retained verified scratch restore and approve any later recovery separately.

No green CI result or `stage3-acceptance.json` authorizes a production merge,
production infrastructure apply or production data migration. Those remain
explicit Stage 4 actions with their own cutover and rollback approval.
