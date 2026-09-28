# Admin Portal - Stage 1 branch freeze

Status: **FROZEN FOR STAGE 2 INPUT**

Date: 28 September 2026

This document closes the isolated Stage 1 review of the `Admin-Portal` branch. It is a branch-readiness record only: it does not authorise a merge into `main`, a production migration, or a production deployment.

## Frozen scope

The Stage 1 Admin baseline includes:

- canonical platform architecture centred on Property;
- staff roles and permissions for administrator, operations manager, inspector and read-only users;
- resource-scoped inspector access and sensitive booking-access controls;
- canonical Client, Property, Tenancy, Booking, Work Order, Document, Request, Communication, Subscription, Payment and Audit relationships;
- typed server-side Admin mutations with referential validation;
- canonical booking-to-property and booking-to-work-order behaviour;
- canonical `propertyDocuments`, `documentRequests`, `workOrders` and `auditEvents`;
- migration tooling for structurally safe legacy records;
- explicit manual review of legacy tenant records where tenancy/property relationships cannot be inferred safely;
- architecture regression checks and production container verification.

## Acceptance gate

The frozen input is the exact `Admin-Portal` commit for which the normal **Verify booking portal** workflow succeeds after this file and the permanent migration preflight are present.

That workflow must pass:

1. deterministic dependency installation;
2. runtime dependency security audit at high severity or above;
3. TypeScript validation;
4. canonical architecture verification;
5. Firestore-emulator migration dry-run preflight;
6. production Vite build;
7. production Docker image build.

The workflow records the exact tested SHA in the `admin-stage1-evidence` artifact. Any later branch change invalidates the freeze until the full gate passes again.

## Migration readiness

`scripts/migrate-admin-platform.ts` remains dry-run by default. Firestore writes require an explicit `--apply`.

The permanent migration preflight seeds representative legacy records into a disposable Firestore emulator, executes the real migration command without `--apply`, validates expected migration counts and asserts that every tracked collection is byte-for-byte unchanged after the run.

Before any future production migration:

- run the migration against the Stage 2 staging dataset first;
- review counts and skipped/missing references;
- reconcile Admin, Client and Tenant migration contracts before applying any one of them;
- do not infer tenant-to-tenancy/property relationships;
- retain a mapping ledger for any cross-model identifiers;
- take the required backups/export snapshots before an apply operation.

## Stage 2 boundary

Stage 2 must resolve branch divergence and converge the Admin, Client and Tenant implementations onto one canonical model. In particular, Client Portal organisation/property/document records must map to the canonical `clients`, `properties`, `clientPropertyLinks` and `propertyDocuments` model rather than establishing parallel stores.

No broad Admin feature development should be added after this freeze. Permitted changes are limited to tested defects, Stage 2 integration compatibility, migration corrections and deployment/security corrections.

Production `main` is intentionally unchanged by this freeze.
