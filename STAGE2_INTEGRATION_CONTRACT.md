# Stage 2 - Platform Unification Contract

Status: **INTEGRATION IN PROGRESS**

Base: production `main` at `6a55131f5890b82047d8b78d2af2bdc6f140041f`

Frozen inputs:

- Admin: `3d4220d0aea05328964296126cdefd6d85ad3123`
- Client: `67f6e3c8a3af02e2f2a98b300510aff4aff38449`
- Tenant: `f4912acd4db0c74a98f3796dee77fb4e02b70484`
- Report Tool: `3b13f4d7f0fcb63a739fde592a58fc7a64d0b2a7`

## Reconciliation rules

1. Production `main` is not an integration environment.
2. Admin's canonical model and resource-scoped RBAC are authoritative for staff/platform administration.
3. Tenant's tenancy, statutory forms, restricted Form 2 boundary, operations, payments, notifications, Report Tool ingestion and migration work are preserved.
4. Client-facing workflows must use canonical `clients`, `clientUsers`, `clientMemberships`, `properties`, `clientPropertyLinks` and `propertyDocuments`. Legacy Client branch collections are migration sources only.
5. Booking remains the customer appointment transaction; `workOrders` remains operational execution.
6. Public `/book`, `/request-document` and `/manage/:token` stay available without portal authentication.
7. Report Tool remains a separate specialist runtime; issued reports enter through authenticated canonical `propertyDocuments` ingestion.
8. No Stage 2 change deploys or merges production `main`.

## Unified entry points

- `/` - portal/public-service gateway
- `/client` - Client Portal
- `/tenant` - Tenant Portal
- `/admin` - Staff/Admin unified operations/platform administration
- `/services` - public service hub
- `/book` - public booking
- `/request-document` - public document catalogue/request
- `/manage/:token` - secure public booking management

Stage 2 is complete only after the permanent release-branch workflow passes at the final exact SHA.
