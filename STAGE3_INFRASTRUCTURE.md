# Stage 3 - Infrastructure, migration rehearsal and integration services

## Scope and evidence boundary

This implementation starts from accepted Stage 2 core `ceebc2f0d312aec6ab68b796a90e04219e771696` on `release/platform-unification`. The companion Report Tool remains separately pinned to `247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707` on `integration/platform-handoff`. Production `main` and the existing production Cloud Run service are not merged, deployed or taken over by Terraform.

**Repository verification is not a live-cloud completion certificate.** Stage 3 operational acceptance requires the cloud evidence listed at the end. No example configuration, successful unit test or emulator run establishes that real storage/IAM/secrets/Workspace sharing have been provisioned. Production infrastructure and migration writes are deliberately locked in the Stage 3 commands; Stage 4 must consume accepted staging evidence and an explicit release approval before adding production execution.

## Ownership and environments

The Client Terraform foundation is retained under its original root resource addresses. Use its existing GCS backend and prefix when adopting existing state. Do not manage the same resource from another Client/Tenant state, Firebase deployment pipeline or a second Terraform workspace. First stop the superseded infrastructure pipeline; back up state; record the sole owner of each resource. This does not stop the existing production application.

Supporting resources now include private versioned platform documents, build sources, Firestore exports and migration evidence; seven Secret Manager containers; separate runtime/build/deploy/migration identities; canonical Firestore indexes; optional database/PITR/rules management; immutable Artifact Registry tags; and repository-ID/owner-ID/branch/environment/workflow-restricted GitHub federation. The deployment script alone manages **staging** Cloud Run revisions and traffic. Existing production service ownership stays unchanged.

Use a separate billed staging project, database, runtime identity, bucket, Firebase Auth tenant/project, Calendar and Report Tool Worker/D1/R2 resources. Never give the staging runtime access to the production Calendar or production data. Do not copy raw production exports into public CI or an uncontrolled staging project. Real-data rehearsal requires an approved, access-controlled, appropriately de-identified copy with synthetic contact details and test-key-encrypted sensitive fields. Emulator fixtures are synthetic only and are not a substitute for a representative staging rehearsal.

## 1. Explicit configuration and minimal bootstrap

Prerequisites: an authorised Google Cloud operator, a dedicated billed staging project, Terraform 1.10.5, Google Cloud CLI, Node 22 and the pinned repository source. No service-account JSON key is required. Authenticate the operator through the organisation's normal keyless mechanism; runtime/migration probes use service-account impersonation. `operator_members` grants impersonation only to explicitly named trusted operators.

Copy `infrastructure/environments/staging.tfvars.example` to a protected local tfvars file. Replace every placeholder, set the separate application origin, actual region, test Calendar IDs and runtime identity. Secrets are numeric references, not values. Copy `infrastructure/backend.staging.hcl.example` to a local backend file. Local actual environment files, plans and credentials must stay outside version control.

```sh
bash infrastructure/bootstrap.sh staging STAGING_PROJECT STATE_BUCKET australia-southeast1
terraform -chdir=infrastructure init -backend-config=/absolute/path/staging.backend.hcl
npm run stage3:infra -- inventory --environment staging --project STAGING_PROJECT --out .stage3/staging-inventory.json
```

Bootstrap verifies project ownership of an existing state bucket before updating its versioning/privacy. It never changes gcloud's global project, grants Owner/Editor, generates service-account keys, provisions secret payloads or changes a runtime service. An API permission failure stops execution rather than being treated as a missing resource.

## 2. Inventory and import; do not recreate

Inventory includes project metadata, databases, composite indexes, storage, secret containers (never payloads), service accounts, repositories, project IAM and Cloud Run names/identities. Separately inspect the live service's **non-secret** database/bucket environment selection to confirm the actual document bucket. The original code contains both a Firebase default bucket and a Client-specific proposed bucket; neither is proof of today's live configuration.

Use `infrastructure/imports.example.json` as a reviewed import manifest. Replace all IDs with actual inventory results, include all pre-existing resources to adopt, and do not import resources already present in the current state. The script refuses duplicate owners and a mismatched manifest/tfvars target. Use provider-documented IDs, for example:

| Existing resource | Terraform address / import ID |
|---|---|
| Required API | `google_project_service.required["firestore.googleapis.com"]` / `PROJECT/firestore.googleapis.com` |
| Documents bucket | `google_storage_bucket.client_documents` / actual bucket name |
| Secret container | `google_secret_manager_secret.runtime["report_ingest_token"]` / `projects/PROJECT/secrets/SECRET_ID` |
| Optional existing runtime account | `google_service_account.runtime[0]` / `projects/PROJECT/serviceAccounts/EMAIL` |
| Optional existing database | `google_firestore_database.platform[0]` / `projects/PROJECT/databases/DATABASE` |
| Existing composite index | `google_firestore_index.canonical["COLLECTION-HASH"]` / full inventory `projects/.../collectionGroups/.../indexes/INDEX_ID` |
| Artifact repository | `google_artifact_registry_repository.platform` / `projects/PROJECT/locations/REGION/repositories/REPOSITORY` |
| Existing project IAM member | `google_project_iam_member.runtime_project_roles["ROLE"]` / `PROJECT ROLE serviceAccount:EMAIL` |

Index keys are derived from the canonical root `firestore.indexes.json`, not separately maintained lists. Match collection, scope and fields; do not create an equivalent existing index under a new owner. Enable optional resource ownership only when creating staging resources or after arranging the exact existing import. For retained production database location and bucket location, use inventory, never guessed region defaults.

```sh
npm run stage3:infra -- import --environment staging --project STAGING_PROJECT --vars /absolute/path/staging.tfvars --manifest /absolute/path/imports.json
npm run stage3:infra -- plan --environment staging --project STAGING_PROJECT --vars /absolute/path/staging.tfvars --out .stage3/staging.tfplan
# Review the Terraform output and the no-delete/no-replace guard; use its exact approval hash.
npm run stage3:infra -- apply --environment staging --project STAGING_PROJECT --plan .stage3/staging.tfplan --approve-plan APPROVED_HASH
terraform -chdir=infrastructure output -json platform > .stage3/platform.json
```

After apply, run a second saved plan and require no unexplained drift. Confirm every required index is `READY`, database deletion protection/PITR is enabled when managed, storage has uniform access/public prevention/versioning, no public principals exist and the expected identities have only their assigned roles. Keep plans/state/exports private: they can contain sensitive metadata even though runtime secrets are excluded.

## 3. Firebase, Workspace and integration configuration

Create/adopt the staging Firebase web application and enable Google sign-in and email-link sign-in in that **staging project**. Set OAuth consent/test users, the staging authorised domain and the provider's redirect URI. Store the web application's public config privately alongside the environment configuration; add the explicit `firestoreDatabaseId` and use the Terraform-managed `documents_bucket` as `storageBucket`. The deployer refuses a production project or backend/browser mismatch. Firebase OAuth provider credentials must not be put in Terraform state, repository files or build arguments. Cloud Firebase account/provider activation is a one-time external prerequisite and is checked by the runtime probe, not silently assumed.

For the separate Report Tool staging Worker, map core `REPORT_HANDOFF_SIGNING_KEY` to Worker secret `PROINSPECT_HANDOFF_SIGNING_KEY`, core `REPORT_INGEST_TOKEN` to `PROINSPECT_INGEST_TOKEN`, and set `PROINSPECT_INGEST_URL` to the staged `/api/integrations/reports` endpoint (never the production URL copied from its example). Set core `REPORT_TOOL_URL` to that separate staged Worker. Preserve Cloudflare Access `TEAM_DOMAIN`/`POLICY_AUD` and role controls. Secret values belong in the Worker's secret store, not Wrangler plaintext variables. No Report Tool deployment or live secret rotation is implied by this repository change.

Create a separate test Google Calendar and share it with the **staging runtime service-account email** as Writer. Include the default and each per-service Calendar ID in `staging_calendar_ids`. Cloud IAM/API enablement alone does not grant Calendar ACL access; Workspace external-sharing policy may require an administrator. The runtime refuses any per-service Calendar override outside that explicit staging allowlist. The API now rejects per-calendar free/busy errors rather than misinterpreting a denied Calendar as free time.

Secret containers exist before payload versions are added. Provide the current encryption key, a unique report-ingest token and a report-handoff signing key from protected files. Configure Resend/Maps/payment credentials only when their staged integrations are required; never use production payment credentials. Staging customer/internal notification email is suppressed by the server even if a real Resend key is accidentally bound. Email-provider acceptance must use a separately approved test-send process; the Stage 3 pipeline never emails customers.

```sh
chmod 600 /private/location/secret-value
node scripts/stage3/secrets.mjs --project STAGING_PROJECT --secret proinspect-staging-report-ingest-token --file /private/location/secret-value --acknowledge-new-version
```

Repeat only for explicitly approved secret versions, then pin the returned **numeric** versions in `runtime_secret_versions`, apply supporting config and export platform output again. Payloads go over stdin to Secret Manager, never into command arguments, Terraform state or CI variables. The script adds a version; it does not automatically activate a runtime version.

For encryption rotation, preserve the current material and label. Add old key-ID/base64 pairs to `ACCESS_DATA_ENCRYPTION_KEYRING`, then activate a distinct current key and `ACCESS_DATA_ENCRYPTION_KEY_ID`. Both booking-access and sensitive document-answer decryptors select the original ciphertext key ID. Do not disable/destroy historical key versions until all dependent ciphertext has been re-encrypted and verified through a separately approved migration. Never replace key bytes while reusing the same application key ID. New staging synthetic data uses new staging keys; do not silently lose the ability to decrypt approved imported ciphertext.

## 4. Repeatable staging build and deployment

```sh
npm run stage3:deploy -- --config .stage3/platform.json --firebase /private/location/firebase-staging-web.json --out .stage3/staging-deployment.json
```

The command archives only the committed source, substitutes the verified public staging Firebase config, uses a dedicated Cloud Build identity/source bucket, tags the image with full source SHA plus Firebase-config hash, and deploys the immutable registry digest. Runtime secrets are pinned numeric Secret Manager references. Staging defaults to private Cloud Run access, maximum two instances, disabled email and dedicated data resources. The deployer refuses public IAM or disabled Invoker IAM enforcement; it cannot rewrite the service's IAM policy.

For an existing staging service, the new revision has a test tag and no traffic until authenticated health/public-route shell checks pass. Evidence records source/config/image/revision and previous traffic. A new staging service has no prior revision to roll back to and remains IAM-protected. HTTP route smoke proves serving/identity isolation; it does not replace authenticated Admin/Client/Tenant workflow tests.

The checked-in `stage3-staging.yml` job requires a successful ordinary **Verify booking portal** run at the exact source SHA before cloud authentication. Configure the GitHub `staging` environment with required reviewer protection and only the release branch. Set environment variables `STAGING_PLATFORM_CONFIG_JSON`, `STAGING_FIREBASE_WEB_CONFIG_JSON`, `STAGING_WIF_PROVIDER`, `STAGING_DEPLOY_SERVICE_ACCOUNT`. These contain identifiers/public web config/numeric references, **not secret payloads**. Federation also enforces the numeric repository/owner IDs, exact release branch, staging environment subject and exact staging workflow path. The deploy identity cannot run database migrations.

While this workflow exists only on the integration branch, request deployment by committing a small `deploy/staging.request.json` containing a request ID/reason. That path is the only push trigger; a routine code push does not deploy. Workflow dispatch is available once GitHub registers the workflow appropriately. Never merge production `main` merely to expose a dispatch button.

For browser tests, use an explicitly authorised private-service access path that preserves the browser's Firebase Authorization header (for example a controlled proxy injecting `X-Serverless-Authorization`). Do not expose staging publicly as an unreviewed workaround. A Cloudflare Report Tool callback to private Cloud Run also needs a Google identity-aware path in addition to the report-ingest token; the ingest token alone does not satisfy Cloud Run IAM.

## 5. Migration dry run, staged apply and reconciliation

The legacy migration remains dry-run-compatible for Stage 2's permanent immutability check, but direct `--apply` is disabled. The new planner is pure and the execution runner requires explicit project/database/environment, full-plan approval, unchanged source content, paused writers and a completed recent same-database Firestore export. No migration is launched from application startup or a deployment step.

Pause **all** staging application/worker/manual writers. The `_stage3Migrations` lock coordinates migration runners, but does not magically stop other applications. Create a reviewed mapping file where legacy organisation, property, document-property or booking-client IDs are ambiguous. Do not infer ownership from email addresses, client-name strings or array order. The planner preserves revoked/disabled access and refuses unresolved identity/address/document/sensitive-evidence conflicts.

```sh
npm run stage3:migrate -- plan --environment staging --project STAGING_PROJECT --database STAGING_DATABASE --mappings /private/location/reviewed-mappings.json --out .stage3/migration-plan.json
# Dry-run writes nothing. Nonzero exit means review the private plan errors before continuing.
gcloud firestore export gs://STAGING_BACKUP_BUCKET/REHEARSAL_ID --project=STAGING_PROJECT --database=STAGING_DATABASE --async --format='value(name)'
# Wait until the returned export operation reports successful completion.
npm run stage3:migrate -- apply --environment staging --project STAGING_PROJECT --database STAGING_DATABASE --plan .stage3/migration-plan.json --approve-plan FULL_PLAN_ID --writers-paused --backup-operation projects/STAGING_PROJECT/databases/STAGING_DATABASE/operations/OPERATION --backup-bucket STAGING_BACKUP_BUCKET --out .stage3/migration-reconciliation.json
npm run stage3:migrate -- verify --environment staging --project STAGING_PROJECT --database STAGING_DATABASE --plan .stage3/migration-plan.json --out .stage3/migration-verified.json
```

Keep every plan private (mode 0600). Plans include before/after data and must never be uploaded as public GitHub artifacts. Whole-root-collection hashes and counts include untouched legacy/audit/other root collections. Native Firestore timestamps, bytes, references and 64-bit integer values are preserved; cross-project/database references fail review rather than being silently retargeted. Nested collections are not migrated or deleted. If a legacy nested schema needs conversion, stop and add a separately reviewed migration for it.

Writes use per-document transactions and before-image hashes, with atomic receipts. A partial failure retains the lock; fix the underlying issue and use the **same approved plan** with `--resume`, or perform guarded rollback. Verified reconciliation requires exact expected counts/content, relationship integrity and a second plan with **zero operations**. Legacy sources and immutable audits remain in place; legacy stores are not reactivated at runtime. Check real referenced storage objects before considering the rehearsal accepted:

```sh
npm run stage3:probe -- --config .stage3/platform.json --storage-plan .stage3/migration-plan.json --write-probes --out .stage3/integration-probes.json
```

This uses an authorised operator to impersonate the runtime identity. It checks Firestore access, Firebase sign-in configuration, referenced migrated storage objects, a unique synthetic storage write/read/delete and separate Calendar read/create/update/delete, with cleanup and no attendees/customer notices. The migration identity and runtime identity are deliberately separate. Index `READY`/privacy/drift checks belong to the infrastructure operator, not the application's data credentials.

Store signed-off summary evidence in the private versioned evidence bucket using a unique object name and a create-only generation precondition. Record object generation and checksums in the release record. Do not treat a locally edited `status: passed` file as independent production approval.

## 6. Failure recovery and production gate

```sh
npm run stage3:migrate -- rollback --environment staging --project STAGING_PROJECT --database STAGING_DATABASE --plan .stage3/migration-plan.json --approve-plan FULL_PLAN_ID --writers-paused --out .stage3/migration-rollback.json
```

Rollback only reverses recorded operations whose current hashes still equal the migration's after-images. It refuses to overwrite later edits. A conflicted or interrupted rollback keeps the lock for investigation; do not delete that lock just to bypass it. Verify the original source hash before releasing writers. Retained export/PITR supports a separate restore investigation if operation-level rollback is inappropriate; restore to a separate recovery database first, never blindly over production.

Cloud Run traffic rollback uses the recorded previous revision/traffic allocation and does not automatically undo database changes. Preserve the old image/secret versions and source collections until release acceptance and the approved retention period. Never roll application code back across a schema boundary without checking compatibility.

Stage 3 tools do not authorise production infrastructure apply or data writes. A future Stage 4 production release must require the exact accepted code/config/image, a signed-off representative staging rehearsal, private generation-pinned reconciliation evidence, a fresh production dry-run with zero unresolved errors, an approved backup/restore strategy, paused/controlled writers, human approval and a monitored rollback plan. Production must never be the first apply environment.

## Operational acceptance checklist

Stage 3 can be signed off only when all these real-environment results exist:

1. Current exact-head ordinary CI passes unit/runtime/migration-emulator/Terraform/security/type/build/container gates, alongside the frozen Report Tool companion's independent gate.
2. Reviewed inventory/import/state ownership, approved staging plan/apply, no unexplained drift, canonical indexes READY, protected database/buckets and least-privilege IAM are recorded.
3. Actual numeric secret versions, Firebase Auth/provider/domain configuration, separate Calendar Writer sharing and runtime integration probes pass.
4. A repeatable staging image/revision deploy succeeds and the authenticated Admin/Client/Tenant/public workflows pass with synthetic contacts and no live email/payment side effects.
5. A representative staging migration has dry-run immutability evidence, fresh completed backup, zero unresolved errors, exact count/content reconciliation, valid file references and zero-write repeat-run evidence. Rollback/resume behaviour has been demonstrated.
6. The separately deployed Report Tool uses the pinned companion, correct handoff/ingest secret pairing, independent staging D1/R2 and a deliberate IAM-compatible callback path; finalise/publish/retry produces exactly one canonical property document and preserves audience/tenant restrictions.

Outstanding real-environment prerequisites must remain marked **not executed** until evidence is captured. A code commit alone does not close these items.

## References

Google Cloud Terraform import guidance: https://cloud.google.com/docs/terraform/resource-management/import
Workload federation for deployment pipelines: https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
Firestore export/import: https://cloud.google.com/firestore/native/docs/manage-data/export-import
Cloud Run revision/traffic management: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration
Google Calendar sharing/ACLs: https://developers.google.com/workspace/calendar/api/concepts/sharing
Identity provider configuration: https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs/get
