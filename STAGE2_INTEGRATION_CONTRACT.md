# Stage 2 - Platform Unification Contract

Status: **FROZEN / COMPLETE SUBJECT TO EXACT-HEAD CI ACCEPTANCE**

Date: 28 September 2026

Base production revision:

- `main`: `6a55131f5890b82047d8b78d2af2bdc6f140041f`

Frozen Stage 1 inputs:

- Admin: `3d4220d0aea05328964296126cdefd6d85ad3123`
- Client: `67f6e3c8a3af02e2f2a98b300510aff4aff38449`
- Tenant: `f4912acd4db0c74a98f3796dee77fb4e02b70484`
- Property Report Tool Stage 1: `3b13f4d7f0fcb63a739fde592a58fc7a64d0b2a7`

Accepted Stage 2 Report Tool companion:

- Repository: `info-rbp/Property-Report-Tool`
- Branch: `integration/platform-handoff`
- Commit: `247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707`
- Normal `Verify V1` run: `36414569752` - **success**

The Report Tool companion starts from the frozen Stage 1 Report Tool SHA and contains integration compatibility only. It is not merged into the core application repository.

## Reconciliation rules

1. Production `main` is not an integration environment and remains unchanged.
2. Admin's canonical platform model and resource-scoped RBAC are authoritative for staff/platform administration.
3. Tenant's tenancy, statutory forms, restricted Form 2 boundary, operations, payments, notifications, migration protections and tenant isolation are preserved.
4. Client-facing workflows use canonical `clients`, `clientUsers`, `clientMemberships`, `properties`, `clientPropertyLinks`, `documentRequests` and `propertyDocuments`. Legacy Client collections are migration sources only.
5. Booking remains the customer appointment transaction. `workOrders` remains operational execution.
6. Public `/book`, `/request-document` and `/manage/:token` remain available without portal authentication.
7. All 17 production WA Residential guided document workflows, form-specific rules, sensitive-answer encryption and customer/internal notification behaviour are preserved.
8. Commercial and Strata document requests use canonical guided instruction workflows.
9. The Property Report Tool remains a separate specialist runtime. Admin opens it through a short-lived signed handoff and completed handoff reports publish back into canonical `propertyDocuments`.
10. Report publication is idempotent: the Report Tool report ID is the canonical source key and retries short-circuit before duplicate file storage.
11. No Stage 2 change deploys or merges production `main`.

## Unified entry points

- `/` - portal/public-service gateway
- `/client` - Client Portal
- `/tenant` - Tenant Portal
- `/admin` - Staff/Admin unified operations and platform administration
- `/services` - public service hub
- `/book` - public booking
- `/request-document` - public guided document catalogue/request
- `/manage/:token` - secure public booking management

## Canonical platform outcomes

Stage 2 converges the portal workstreams around:

- `clients`
- `clientUsers`
- `clientMemberships`
- `properties`
- `clientPropertyLinks`
- `tenancies`
- `tenantUsers`
- `bookings`
- `workOrders`
- `propertyDocuments`
- `documentRequests`
- `communications`
- `subscriptions`
- `payments`
- `adminUsers`
- `auditEvents`
- `services`
- `settings`

The runtime does not reactivate legacy `clientOrganisations`, `clientProperties`, `clientDocuments` or `maintenanceRequests` as parallel operational stores.

## Client convergence

The unified Client Portal now provides canonical:

- verified client identity and explicit memberships;
- self-onboarding;
- organisation/client metadata including billing email, ABN and ACN;
- multi-client access and role enforcement;
- property creation/relationships;
- linked bookings;
- maintenance and general requests;
- Commercial/Strata document requests written directly to canonical `documentRequests`;
- document visibility/download;
- approval responses;
- payments and notifications;
- team access management.

Residential prescribed-form requests continue through the stricter guided Residential workflow.

## Migration readiness

`scripts/migrate-unified-portal.ts` is dry-run by default and requires explicit `--apply` for writes.

The migration converges:

- booking/property/client relationships;
- missing canonical client roles and memberships;
- legacy Client `clientOrganisations` into canonical `clients`;
- legacy-shaped `clientMemberships` into canonical client-user memberships;
- legacy `clientProperties` into canonical properties/client-property links;
- legacy `clientDocuments` into canonical property documents;
- organisation metadata including billing email, ABN and ACN.

Ambiguous or orphaned legacy memberships are counted for manual review rather than silently inferred.

The permanent Firestore-emulator preflight executes the real migration in dry-run mode and asserts zero mutations across source and target collections.

No production migration is authorised in Stage 2. Migration apply/rehearsal belongs to the Stage 3 staging/infrastructure phase.

## Admin and security convergence

The unified Admin surface retains both operational workflows and canonical platform administration.

The Stage 2 contract requires:

- canonical Admin session resolution;
- explicit role/permission vocabulary;
- resource-scoped booking reads and writes;
- property/client/tenancy/document/work-order referential validation;
- staff roles for administrator, operations manager, inspector and read-only users;
- tenant isolation and sensitive Form 2 boundaries;
- no direct browser Firestore/Storage authority;
- immutable canonical audit events.

## Property Report Tool integration

Admin staff with `reports.manage` can select a canonical Property and optional Booking, Work Order and Tenancy context and open the separate Property Report Tool.

The core platform:

- validates canonical relationships;
- issues a five-minute HMAC-signed handoff token;
- never exposes the signing key or ingest token to browser code;
- records the handoff in audit history.

The Report Tool:

- applies its existing Cloudflare Access and editor/admin role boundary first;
- verifies the signed handoff in the Worker;
- retains canonical context in report data;
- uses canonical Property ID as its stable local reference;
- preserves its D1/R2/revision/PDF/finalisation architecture;
- completes its revision-aware immutable transition first so only the winning PDF revision can be published;
- publishes that immutable PDF server-to-server to the canonical platform;
- exposes an idempotent **Sync to ProInspect** retry action if platform publication is temporarily unavailable.

The core ingest endpoint validates PDF bytes and canonical relationships and stores the issued report as a canonical property document. The Report Tool report ID provides idempotency across retries.

## Permanent Stage 2 acceptance gate

Stage 2 is accepted only at the exact `release/platform-unification` commit for which the normal **Verify booking portal** workflow succeeds after this contract is present.

That workflow must pass:

1. deterministic dependency installation;
2. runtime dependency security audit;
3. TypeScript validation;
4. architecture/portal-isolation freeze checks;
5. Firestore-emulator migration dry-run immutability;
6. Stage 2 platform-unification regression contract;
7. production Vite build;
8. production Docker image build;
9. exact source SHA evidence artifact.

The Stage 2 evidence artifact is named `stage2-platform-unification-evidence`.

The accepted Report Tool companion must independently pass its normal `Verify V1` workflow at the exact companion SHA, including dependency security, TypeScript, production build, handoff contract, authentication boundary, Worker API/concurrency/storage tests, deterministic PDF regression and Wrangler dry-run.

Any later change to either frozen integration input invalidates Stage 2 acceptance until its full permanent gate succeeds again.

## Stage 3 boundary

Stage 3 may begin only from the accepted exact Stage 2 SHAs.

Stage 3 owns:

- Terraform/platform infrastructure convergence;
- staging resources and environment configuration;
- secret provisioning/rotation;
- Firestore indexes and storage/IAM deployment;
- migration rehearsal and apply procedures;
- Report Tool integration secret configuration;
- Cloud Run deployment/cutover preparation.

Stage 3 must not use production as the first environment for the combined migration.

No production deployment or merge is authorised by this Stage 2 freeze.
