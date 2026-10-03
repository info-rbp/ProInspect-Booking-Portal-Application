# Cloudflare Production Runbook

## Architecture

The accepted production target is one Cloudflare Worker deployment combining static assets and API routing. D1, R2, Durable Objects, Queues, Email Service, Turnstile and Worker secrets are bound directly to the Worker. Google/Firebase is a read-only migration/rollback source only.

Production account discovered by readiness: `8ca23ac6d2cc906d4dd13b8da5ea2b25`.

Production Worker: `proinspect-platform`.

Current deployment origin: `https://proinspect-platform.delicate-dream-e4c9.workers.dev`.

Final custom-domain activation is `bookings.proinspect.systems` after pre-traffic acceptance.

## Environment isolation

Production and staging must never share:
- D1 database;
- ordinary R2 bucket;
- sensitive R2 bucket;
- Queue or dead-letter Queue;
- Worker name;
- session/auth records;
- encryption/file-signing secrets.

Staging email is forced to a controlled sink address.

## Secrets register

Never commit secret values. Runtime secret names:
- `ACCESS_DATA_ENCRYPTION_KEY`
- `ENCRYPTION_KEYS_JSON`
- `FILE_SIGNING_KEY`
- `REPORT_HANDOFF_SIGNING_KEY`
- `REPORT_INGEST_TOKEN`
- `TURNSTILE_SECRET_KEY`
- optional `PAYMENT_WEBHOOK_TOKEN`

GitHub deployment credential:
- `CLOUDFLARE_API_TOKEN`

## Release phases

### readiness
Read-only. Verifies exact source CI and Cloudflare account capabilities.

### bootstrap
Protected production approval. Provisions/discovers Cloudflare resources, applies D1 schema, installs Worker secrets, deploys the full Worker in maintenance mode and verifies that `/healthz` is a Worker JSON response rather than SPA fallback.

### migrate
Protected production approval. The sequence is fail-closed:
1. deploy/verify Cloudflare maintenance mode;
2. remove public invocation from the legacy Cloud Run writer;
3. capture final Firestore/Storage backup evidence;
4. capture the pre-migration D1 Time Travel bookmark;
5. export a stable canonical Firestore snapshot;
6. import external Google Calendar busy intervals;
7. apply the exact D1 migration plan;
8. run a second migration pass and require zero writes;
9. copy referenced objects to the correct R2 bucket and verify SHA-256;
10. capture post-migration D1 rollback/export evidence.

If the migrate job fails after removing legacy public invocation, its failure handler restores legacy public invocation automatically.

### promote
Protected production approval. Rebuilds the exact accepted SHA in live mode, deploys, executes remote smoke checks and performs controlled transactional-email verification.

### close
Verifies live Worker behavior and confirms the legacy Cloud Run service is no longer publicly invokable.

## Backup and recovery

Before final migration:
- retain a server-side Firestore export in the GCP migration-backup bucket;
- inventory Firebase Storage objects and retain hashes/metadata;
- record source collection/object counts and digests;
- capture the current D1 Time Travel bookmark;
- retain post-migration D1 evidence.

D1 Time Travel is the short-window point-in-time rollback mechanism. A restore overwrites the database in place, so it requires an explicit incident decision and a reviewed bookmark. Long-term export evidence should be retained separately.

Do not delete GCP during the rollback period.

## Rollback decision

Before custom-domain/live acceptance:
- if Cloudflare migration/deploy fails, keep or restore the legacy GCP public writer and investigate off-line;
- do not partially reconcile production manually.

After Cloudflare has accepted writes:
- prefer fixing forward when data has diverged;
- use D1 Time Travel only with an explicit incident decision and verified bookmark;
- never reopen Firestore writes without an explicit reverse-migration plan.

## Operator acceptance

Use controlled identities and data. Acceptance must prove:
- Public booking create/manage/cancel and ICS;
- public document request;
- Client passwordless sign-in, property/documents/approvals/payments/notifications;
- Tenant passwordless sign-in, requests/attachments/documents/inspections/statutory forms;
- Staff authentication/RBAC and operations;
- restricted Form 2 isolation;
- work-order/contractor/approval lifecycle;
- Report Tool PDF ingestion and audience visibility;
- Cloudflare email delivery;
- queue retry/dead-letter health;
- no Google/Firebase runtime dependency.

## Post-live observation

Review Worker exceptions, D1 failures, Queue retries/dead letters, authentication/RBAC failures, R2 access failures, email delivery failures, booking conflicts and response time.

Only after this passes should the release merge to `main` and legacy GCP code removal begin.
