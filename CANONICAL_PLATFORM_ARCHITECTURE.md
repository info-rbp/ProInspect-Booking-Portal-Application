# ProInspect Canonical Platform Architecture

This document is the architecture contract for the `Admin-Portal` P0 freeze work. It defines the canonical Firestore entities that the Admin, Client and Tenant portals must share when their branches are consolidated.

## Core principle

A Property is the central operational entity. Client relationships, tenancies, bookings, work orders, documents, requests, communications, subscriptions and payments link to a canonical Property rather than maintaining independent copies of the same property.

## Canonical collections

| Collection | Purpose |
| --- | --- |
| `clients` | Client/organisation source of truth |
| `clientUsers` | Client login identities |
| `clientMemberships` | Explicit client-user memberships and roles |
| `properties` | Canonical property records |
| `clientPropertyLinks` | Client-to-property relationships |
| `tenancies` | Property tenancy periods |
| `tenantUsers` | Tenant login identities linked to tenancies |
| `bookings` | Appointment/customer booking records |
| `workOrders` | Operational work records sourced from bookings or requests |
| `propertyDocuments` | Stored/generated property documents and reports |
| `documentRequests` | Canonical public/client/admin document requests |
| `communications` | Communication history |
| `subscriptions` | Client/property service subscriptions and allowances |
| `payments` | Charge/payment records linked to source entities |
| `adminUsers` | Staff identity, role, permissions and resource scope |
| `auditEvents` | Unified immutable platform audit trail |
| `services` | Booking/service catalogue |
| `settings` | Business and scheduling configuration |
| `bookingAccessSecrets` | Encrypted booking access credentials |
| `scheduleLocks` | Server-only booking concurrency locks |

The legacy `tenants` and `maintenanceRequests` collections are not part of the canonical model. Tenant identities use `tenantUsers` plus `tenancies`; maintenance activity uses `workOrders`.

## Identity and relationship model

### Staff

`adminUsers` holds the internal identity record. Staff roles are:

- `administrator`
- `operations_manager`
- `inspector`
- `read_only`

A staff record may be pre-authorised by email. On first Google/Firebase sign-in, the record binds to the real Firebase UID. If the temporary document ID was used for booking/work-order assignments, those assignments are migrated to the UID during binding.

Inspectors default to `resourceScope=assigned`. Their visible records are restricted to work assigned directly to their UID or to explicitly assigned client/property IDs. Sensitive booking access details are subject to both permission and resource scope.

### Clients

A `clientUsers` identity is related to one or more `clients` through explicit `clientMemberships`. The cached `clientIds` and `clientRoles` fields on `clientUsers` exist for portal compatibility/performance but the membership documents are the relationship source of truth.

### Properties

A Property may relate to multiple clients through `clientPropertyLinks`. Each link records the relationship role (owner, landlord, managing agent, asset manager, strata manager or other) and whether it is the primary relationship.

`properties.primaryClientId` is a compatibility/convenience field. Creating or assigning a primary client automatically maintains an explicit link document.

### Tenants

A tenant identity exists in `tenantUsers`. Tenant access to a property occurs through one or more `tenancies`; a user holds tenancy IDs rather than a direct unrestricted property ID.

## Booking and work-order boundary

A Booking represents the appointment/customer transaction and retains the public management token, service, embedded booking-time property snapshot, access method and appointment.

A Work Order represents operational execution.

New public bookings:
1. create/reuse a canonical Property;
2. save `propertyId` on the Booking;
3. atomically create `workOrders/booking_<bookingId>` in the same Firestore batch as the Booking;
4. keep Work Order state synchronized when the Booking is completed/cancelled or reassigned.

This allows non-booking sources (tenant request, client request, document request or manual work) to create the same Work Order entity without forcing every operational task to be a Booking.

## Canonical document model

`propertyDocuments` links a file/report to:
- Property (required)
- zero or more Clients
- optional Tenancy
- optional Booking
- optional Work Order
- optional Request

It records audience, category, storage path, content type, size, version and lifecycle status.

Lifecycle:
`draft -> generated -> review -> approved -> issued -> archived`

The storage object itself remains external to Firestore; Firestore stores metadata and relationships.

## Canonical document request model

All document requests use the same `documentRequests` schema whether they originate from the public request form, a future Client Portal, or staff.

The public API preserves the existing public response shape but persists:
- `reference`
- `documentProductId`
- requester identity/contact
- canonical Property ID
- optional Client/ClientUser/assigned staff
- pricing mode/price
- lifecycle status
- generated document/payment links

Legacy request documents are read through a compatibility normalizer and can be permanently migrated with the migration utility.

## Subscription and payment model

A `subscription` belongs to a Client and may optionally be property-specific. It contains a plan code, fee, dates, status and structured allowances.

A `payment` links to a source entity:
- booking
- document request
- work order
- subscription
- other

Amount ex GST, GST and total are separate fields. Provider status may later be reconciled with Xero/payment providers without changing the core model.

## Referential integrity

The browser does not write platform collections directly. All Admin mutations pass through the Express trusted server.

Server validation rejects:
- missing referenced Client, Property, Tenancy, Staff, Booking, Work Order or Document;
- Client/Property combinations without an active relationship link;
- Tenancy/Property mismatches;
- invalid Work Order source records;
- invalid Payment source records;
- invalid enum/status values;
- malformed structured fields.

Firestore itself is schema-less; these server validators are therefore part of the architecture contract.

## Unified audit model

All new audit events use:

- `entityType`
- `entityId`
- `action`
- `summary`
- `actor { type, id?, email?, displayName? }`
- optional `propertyId`, `clientId`, `tenancyId`
- metadata
- `createdAt`

Actor types:
- staff
- client
- tenant
- system
- integration

Legacy Admin audit events remain readable and the migration utility can normalize them.

## Migration

Run a dry-run only:

```bash
npm run migrate:platform
```

No Firestore writes occur without `--apply`.

After reviewing counts:

```bash
npm run migrate:platform:apply
```

The migration safely backfills:
- booking Property links;
- booking-backed Work Orders;
- legacy document requests;
- legacy maintenance requests into Work Orders where a canonical Property exists;
- structurally safe legacy Client/Property/Document/Subscription/Communication/Audit records.

Legacy `tenants` documents are reported but deliberately not auto-migrated because creating a Tenant identity without an explicit Tenancy/Property relationship would require guessing business relationships.

## Architecture regression verification

CI runs:

```bash
npm run test:architecture
```

This protects the canonical resource registry, role permissions and inspector resource-scope behavior in addition to normal TypeScript/build/container verification.
