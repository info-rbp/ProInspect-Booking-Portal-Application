# Tenant Portal Branch Freeze

Status: **FROZEN FOR COORDINATED MERGE**

Date: 28 September 2026

The `tenant-portal` branch has completed its pre-merge architecture and security review.
No additional broad feature development should be added to this branch before the
coordinated merge into `main`.

Permitted changes after this freeze are limited to:

- merge/rebase conflict resolution required to integrate the latest `main`;
- defects discovered by staging migration, security or end-to-end testing;
- environment/deployment corrections required to activate already-implemented features;
- current statutory-form/template updates required before deployment.

The branch freeze includes:

- Booking Portal and canonical booking/property/client relationships;
- Client Portal with multi-client membership roles and access revocation;
- Tenant Portal with per-tenant request isolation;
- WA statutory tenant-form workflows, with Forms 22 and 23 intentionally excluded;
- restricted Form 2 family-violence storage, audit and staff-access boundary;
- canonical property documents and Property Report Tool ingestion;
- unified staff operations, maintenance/work orders and client approvals;
- payment records/provider adapter;
- immutable audit history and portal notifications;
- migration/backfill tooling;
- Firestore indexes and deny-all browser Firestore/Storage rules;
- deployed portal security smoke tests;
- executable `npm run freeze:check` architecture gate.

Before merging into `main`, follow the staging and migration checklist in
`CLOUD_RUN_DEPLOYMENT.md`. Do not use production as the first environment for the
combined portal migration.
