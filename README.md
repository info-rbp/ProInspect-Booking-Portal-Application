# ProInspect Platform

ProInspect is a four-surface property-services platform for Public, Client, Tenant and Staff users.

The active completion branch is `release/cloudflare-platform`. The target production runtime is Cloudflare Workers. The former Google Cloud/Firebase deployment is retained only as a migration and rollback source until the Cloudflare release has passed production acceptance.

## V1 runtime architecture

The production build deploys the React/Vite application and API Worker as one unit.

- **Cloudflare Workers** — application and API runtime.
- **D1** — canonical application data, authentication/session state, email outbox and migration records.
- **R2** — ordinary documents and a separate restricted/sensitive evidence bucket.
- **Durable Objects** — serialization of concurrency-sensitive booking writes.
- **Queues** — transactional email delivery, retries and dead-letter handling.
- **Cloudflare Email Service** — outbound transactional delivery.
- **Turnstile** — abuse protection for public sign-in and submission flows.
- **Cloudflare Access (optional)** — Staff SSO front door. ProInspect RBAC remains authoritative for application authorization.
- **Workers secrets** — encryption keys, Report Tool credentials and signing material.

The accepted Worker bundle must contain no Firebase Admin, Google Calendar, Google Maps or Google Cloud runtime dependency. Google/Firebase are used only by one-time migration tooling and retained rollback evidence until the rollback period closes.

## V1 product scope

The frozen V1 scope includes:

- public service gateway;
- booking, management and cancellation;
- public document requests;
- Client Portal;
- Tenant Portal;
- Staff/Admin Portal;
- clients, memberships, properties, tenancies and tenant users;
- WA statutory tenant workflows;
- tenant/client maintenance and general requests;
- contractors and work orders;
- approvals;
- documents and restricted evidence;
- notifications;
- provider-neutral payment/status handling;
- immutable audit records;
- Report Tool ingestion and audience delivery.

No new major product module is added before launch.

## Completion documentation

- `docs/CLOUDFLARE_V1_CONTRACT.md` — frozen product and runtime contract.
- `docs/CLOUDFLARE_COMPLETION_AUDIT.md` — status against the approved 50-point completion plan.
- `docs/CLOUDFLARE_PRODUCTION_RUNBOOK.md` — deployment, migration, backup and rollback procedure.
- `docs/CLOUDFLARE_ACCEPTANCE_CHECKLIST.md` — staging, pre-traffic, live and closure gates.

Legacy GCP runbooks remain in the repository only for rollback/reference until Cloudflare production acceptance has passed.

## Development and permanent verification

Use Node 22.

```bash
npm ci
npm run cloudflare:check
```

The Cloudflare verification workflow additionally:

1. verifies that browser compatibility changes are already committed;
2. checks the reviewed D1 schema checksum;
3. runs database, migration, authentication, encryption and authorization tests;
4. type-checks the application;
5. builds the actual Worker;
6. exercises the preserved business APIs against isolated SQLite;
7. performs a Wrangler upload dry-run;
8. starts a local Worker and verifies public/API security behavior.

The Worker build fails if Firebase or Google runtime libraries enter the production bundle.

## Environment separation

Local, staging and production resources are intentionally separate. Staging and production must not share:

- D1 databases;
- R2 document buckets;
- R2 sensitive buckets;
- Queues or dead-letter Queues;
- Worker names;
- sessions/auth state;
- encryption/file-signing secrets.

Staging email is redirected to a controlled sink and must never deliver to real customers.

## Production deployment

Production is controlled by:

- `ops/cloudflare-production-request.json`
- `.github/workflows/cloudflare-production.yml`

The controlled phases are:

```text
readiness -> bootstrap -> migrate -> promote -> close
```

Every mutating phase uses the protected GitHub `production` environment and an exact verified source SHA.

A `workers.dev` page loading successfully is not production acceptance. The backend Worker, D1/R2/Queues/Email bindings, migrated data and real Public/Client/Tenant/Staff workflows must pass the acceptance checklist.

## Legacy GCP status

The Cloudflare release is the active deployment target.

Do not approve or restart the old Stage 3/Stage 4 GCP production cutover while this migration is in progress. Cloud Run, Firestore, Firebase Storage and Google Calendar remain available only as migration/rollback sources until Cloudflare is accepted.

After live acceptance:

1. keep GCP read-only for the agreed rollback period;
2. merge the accepted Cloudflare release to `main`;
3. remove obsolete GCP runtime/deployment code;
4. retire GCP application infrastructure deliberately after backups and rollback evidence have been verified.
