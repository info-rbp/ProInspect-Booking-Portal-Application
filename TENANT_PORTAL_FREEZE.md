# Tenant Portal - Stage 1 branch freeze

Status: **FROZEN FOR STAGE 2 INPUT**

Date: 28 September 2026

This document closes the isolated Stage 1 review of the `tenant-portal` branch. It is a branch-readiness record only and does not authorise a merge into `main`, a production migration, or a production deployment.

## Frozen scope

The Stage 1 Tenant baseline includes:

- Booking Portal and canonical booking/property/client relationships;
- Client Portal foundations with multi-client membership roles and access revocation;
- Tenant Portal with per-tenant request isolation;
- WA statutory tenant-form workflows, with Forms 22 and 23 intentionally excluded;
- restricted Form 2 family-violence storage, audit and staff-access boundary;
- canonical property documents and Property Report Tool ingestion;
- unified staff operations, maintenance/work orders and client approvals;
- payment records/provider adapter;
- immutable audit history and portal notifications;
- migration/backfill tooling;
- Firestore indexes and deny-all browser Firestore/Storage rules;
- deployed-environment portal security smoke-test tooling;
- executable `npm run freeze:check` architecture and isolation gate.

## Acceptance gate

The frozen input is the exact `tenant-portal` commit for which the normal **Verify booking portal** workflow succeeds after this file and the permanent migration preflight are present.

The workflow must pass:

1. deterministic dependency installation;
2. runtime dependency security audit at high severity or above;
3. TypeScript validation;
4. architecture, direct-access and tenant-isolation invariants;
5. Firestore-emulator migration dry-run preflight;
6. production Vite build;
7. production Docker image build.

The workflow records the exact tested SHA in the `tenant-stage1-evidence` artifact. Any later branch change invalidates the freeze until the full gate passes again.

## Security review boundary

The permanent branch gate verifies that:

- direct browser Firestore access remains denied;
- direct browser Storage access remains denied;
- restricted Form 2 data uses separate storage/collections;
- tenant request and statutory-form reads remain scoped to the submitting tenant;
- booking visibility does not fall back to customer-email ownership;
- read-only staff writes remain permission-gated;
- Client Portal membership revocation and last-owner protections remain wired.

`scripts/e2e-portal-security.mjs` remains the deployed non-production smoke suite for real Firebase ID-token role testing. It requires provisioned staging identities/tokens and therefore belongs to the Stage 2 staging rehearsal rather than a production-free Stage 1 branch run. Production must not be the first environment where that suite is exercised.

## Migration readiness

`scripts/migrate-unified-portal.ts` is dry-run by default. Firestore writes require explicit `--apply`.

The permanent migration preflight seeds representative canonical and legacy Client/Property/Document records into a disposable Firestore emulator, executes the real migration command without `--apply`, validates its expected discovery/backfill counts and asserts that all tracked source and target collections remain unchanged.

Before any migration apply:

- run the unified migration against the Stage 2 staging dataset first;
- resolve duplicate property address keys;
- review bookings without reliable client context instead of inferring landlord identity from the requester;
- reconcile Admin and Client migration contracts before applying any independent migration;
- take a Firestore export/backup;
- deploy required indexes and validate runtime secrets/permissions in staging.

## Post-freeze change rule

No additional broad feature development should be added to this branch before coordinated integration.

Permitted changes are limited to:

- defects discovered by staging migration, security or end-to-end testing;
- Stage 2 integration compatibility fixes;
- environment/deployment corrections required to activate already-implemented features;
- current statutory-form/template corrections required before deployment.

Production `main` remains unchanged by this freeze.
