# Cloudflare V1 Product Contract

Status: **Frozen for launch**

No new major product module is added until this contract passes production acceptance.

## Surfaces

### Public
- service/category discovery;
- booking creation with Australian property/contact/access validation;
- native ProInspect availability and atomic reservation;
- confirmation, calendar invitation, secure management token and cancellation;
- public Residential/Commercial/Strata document request catalogue and guided request flows.

### Client Portal
- passwordless sign-in and session management;
- organisation membership and role-aware access;
- canonical linked properties and tenancies;
- operational/client requests;
- documents and report visibility;
- work-order visibility;
- approvals and approval responses;
- payment/status visibility;
- notifications.

### Tenant Portal
- passwordless sign-in and tenancy-scoped access;
- property/tenancy overview;
- maintenance/general requests and attachments;
- request status;
- documents and inspection visibility;
- notifications;
- WA Forms 24–27, bond release/variation, PCR response;
- restricted Form 2 workflow with separate evidence/storage/audit isolation.

### Staff
- authentication plus ProInspect RBAC;
- dashboard and staff management;
- client/property/tenancy/tenant-user management;
- booking/service management;
- document processing and uploads;
- contractor/work-order operations;
- approvals, payments and operational queues;
- ordinary and restricted statutory-form review with separate permissions;
- audit access;
- Report Tool/integration status.

## Canonical records

V1 uses one canonical graph for clients, memberships, properties, client-property links, tenancies, tenant users, services, bookings, booking secrets, document products/requests, tenant/client requests, statutory forms, sensitive forms, property documents, contractors, work orders, approvals, payments, notifications, audit records, scheduling events and system settings.

D1 is the runtime system of record after cutover. The compatibility layer preserves the reviewed collection-oriented application boundary while persisting each canonical collection in its own D1 table with queryable relationship columns.

## Runtime contract

- Cloudflare Workers serves UI and API.
- D1 persists application/auth state.
- R2 persists ordinary and restricted files in separate buckets.
- Durable Objects serialize booking writes.
- Queues carry encrypted email jobs with retry/dead-letter behavior.
- Cloudflare Email Service delivers transactional mail.
- Turnstile protects public authentication/submission paths.
- Staff may use Cloudflare Access, but application authorization is always ProInspect RBAC.
- Application-level encryption remains mandatory for lockbox/alarm/confidential answers and restricted evidence.
- Google/Firebase services are migration sources only, never runtime dependencies after acceptance.

## Explicit V1 non-goals

- new portal/module families;
- replacing external payment networks with an in-house processor;
- automated legal decision-making for statutory processes;
- address autocomplete as a launch dependency;
- Cloudflare Workflows where a short transactional request or Queue is already sufficient. Workflows may be introduced later for genuinely long-running orchestration without changing this contract.

## Completion gate

V1 is complete only when:
1. Public, Client, Tenant and Staff surfaces pass real production acceptance.
2. Required workflows above pass with migrated production relationships.
3. sensitive Form 2 and encrypted evidence isolation is proven.
4. D1/R2 migration and second-pass idempotence succeed.
5. pre-cutover backup plus D1 rollback evidence exists.
6. Cloudflare CI/CD and protected production promotion pass.
7. controlled live transactions pass.
8. `main` matches the accepted production source.
9. the active runtime has no Google/Firebase/GCP dependency.
