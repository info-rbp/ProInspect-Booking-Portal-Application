# ProInspect Booking Portal

This repository contains the ProInspect customer booking portal and internal operations view.

## Runtime architecture

- React + Vite customer/admin interface
- Express server
- Firebase Authentication for administrator sign-in
- Firebase Admin SDK for trusted server-side Firestore access
- Firestore collections:
  - `services`
  - `bookings`
  - `settings`
  - `adminUsers`
- Google Calendar API for FreeBusy queries and event creation
- Australia/Perth timezone

The browser does not write booking records directly to Firestore. Public booking creation and all administrator operations go through the Express API.

## Google Cloud Run configuration

Keep application code in GitHub and deploy the production Docker image to Google Cloud Run. Production authentication to Google services uses the assigned Cloud Run service account through Application Default Credentials rather than committed private keys.

Required server configuration is documented in `.env.example`; the production deployment runbook is in `CLOUD_RUN_DEPLOYMENT.md`.

For production scheduling:

1. Enable the Google Calendar API in the Google Cloud project.
2. Create or select a dedicated ProInspect Google Calendar.
3. Set `GOOGLE_CALENDAR_ID` to that calendar ID.
4. Ensure the runtime service account has write access to the calendar. A common approach is to share the dedicated calendar with the service-account email.
5. Ensure the Cloud Run runtime identity can access the configured Firestore database.
6. Leave `FIREBASE_SERVICE_ACCOUNT_JSON` and `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` unset in production so the server uses Application Default Credentials.
7. Enable Google as a Firebase Authentication sign-in provider for the client app.

## Administrator access

Administrator API routes require a Firebase ID token.

An authenticated account is authorised when either:

- its email appears in `ADMIN_EMAILS`, or
- an `adminUsers/{firebaseUid}` Firestore document exists with `active` not set to `false`.

Direct browser access to Firestore is denied by `firestore.rules`; the Admin SDK accesses Firestore from the trusted server runtime.

## Firestore seed data

On server startup, the application creates missing default documents for:

- the initial service catalogue in `services`
- business scheduling configuration at `settings/business`

These defaults are seed values only. Once Firestore documents exist, Firestore is the runtime source of truth.

## Booking privacy

Public booking lookup uses the random management token generated at confirmation. Predictable booking references are not accepted by the public lookup endpoint.

Sensitive access information such as lockbox codes, alarm details, key references and tenant data is kept in the internal booking record. Google Calendar events contain a reduced operational summary and deliberately exclude those sensitive access details.

## Development

```bash
npm ci
npm run lint
npm run build
npm run dev
```

The GitHub Actions workflow in `.github/workflows/verify.yml` performs deterministic dependency installation, type-checking, production build verification and a production Docker image build.

## Production deployment workflow

Use GitHub as the source of truth for reviewed code changes:

1. Make and review changes in GitHub.
2. Merge the approved pull request into `main` only after verification passes.
3. Google Cloud Build detects the `main` update, builds the Dockerfile and deploys a new Cloud Run revision.
4. Keep runtime configuration in Cloud Run and Google IAM rather than in GitHub.


## Service management

Authorised staff can manage the live booking catalogue from **Staff Portal > Booking Services**.

Supported operations:
- add a service
- edit its customer-facing name and description
- set duration, buffers, notice period and booking horizon
- activate or deactivate a service
- make a service public or internal
- reorder services
- optionally assign a service-specific Google Calendar ID

Service IDs are permanent after creation. Services are never deleted through the V1 interface; deactivation preserves historical bookings and prevents new bookings.

Firestore remains the runtime source of truth. Changes made in the Staff Portal are written to `/services/{serviceId}` and active public services update the public booking flow immediately.


## Booking reliability and security

Production booking creation is validated and committed server-side. The booking flow now includes:

- server-side Australian property, contact and access validation
- Google Maps Platform address autocomplete and address validation
- tenant-access readiness states for issued, pending and missing entry notice
- Google Calendar availability recheck and transactional Firestore schedule locks
- field-level AES-256-GCM encryption for lockbox codes and security-alarm details
- a branded customer confirmation email with a secure booking-management link
- customer self-service booking lookup and cancellation using an unguessable management token
- a controlled live end-to-end smoke test for Calendar write/delete and Firestore persistence

Sensitive lockbox/alarm values are not stored in the normal `bookings` document and are not copied to Google Calendar. New sensitive values are written to the separate `bookingAccessSecrets` collection only after encryption and are restored only for authenticated staff API responses.

The application fails closed for new lockbox/alarm bookings when `ACCESS_DATA_ENCRYPTION_KEY` is not configured.

See `CLOUD_RUN_DEPLOYMENT.md` for the required Google APIs, email configuration, encryption secret and production verification procedure.


## Tenant portal module

The `tenant-portal` branch extends the booking application into a shared
Client / Tenant / Staff platform without changing the existing booking data model.

Tenant-facing capabilities include:

- passwordless email sign-in tied to provisioned tenant records
- property and tenancy overview
- maintenance and general tenancy requests
- photo, PDF and supported video attachments
- request status tracking
- tenancy document access through short-lived signed URLs
- inspection and access schedule visibility
- request receipt and status-update emails

Staff capabilities include:

- create properties
- create tenancies
- provision tenant portal users
- review and update tenant requests
- upload tenancy documents
- add inspections visible in the tenant portal

Tenant browsers do not access Firestore or Firebase Storage directly. Firebase ID
tokens are verified by the Express server and every tenant operation is scoped to
the tenancy IDs assigned to the authenticated tenant record.


## Shared client, property and document architecture

The tenant portal branch uses a shared Firestore graph so a future Client Portal can
consume the same property and document records rather than maintaining a separate
client-only database.

```text
clients
  |
  +-- clientUsers
  |
  +-- clientPropertyLinks ---- properties
                                |
                                +-- tenancies ---- tenantUsers
                                |
                                +-- propertyDocuments
                                |
                                +-- tenantRequests
                                |
                                +-- tenantInspections
```

Canonical relationships:

- `clients` stores the landlord, agency, commercial landlord, strata company,
  asset manager or other ProInspect client.
- `clientUsers` stores authenticated people who may later sign into a Client Portal
  and references one or more `clientIds`.
- `clientPropertyLinks` is the many-to-many relationship between clients and
  properties, including relationship role and whether the client is primary.
- `properties` is the canonical property record shared by Client, Tenant and Staff
  workflows. `primaryClientId` is available as a convenient denormalised pointer,
  while `clientPropertyLinks` remains the source of truth for access.
- `tenancies` always belongs to a property and may retain the property's primary
  `clientId` for reporting and workflow context.
- `propertyDocuments` is the canonical document collection. A document always has
  a `propertyId`, may have a tenancy-specific `tenancyId`, has one or more
  `clientIds`, and has explicit `audiences` of `tenant`, `client` and/or
  `staff`.

This means an inspection report, PCR, maintenance invoice or correspondence file is
stored once and can be surfaced in different portals based on audience and
relationship permissions.

The server already exposes protected client-read foundations:

- `GET /api/client/session`
- `GET /api/client/dashboard`
- `GET /api/client/documents/:id/download`

The Client Portal user interface itself is intentionally not implemented on this
branch. A later Client Portal branch can authenticate a provisioned `clientUsers`
record and consume these APIs without changing the Firestore data model.


## Consolidated operations platform

The `tenant-portal` branch is now the consolidation branch for the wider ProInspect
application platform.

It includes:

- shared Client → Property → Tenancy data architecture
- Client Portal and Tenant Portal
- public Residential / Commercial / Strata document request catalogue
- unified staff operations queue
- client and tenant requests
- contractor directory and maintenance work orders
- client approvals
- property document visibility across portals
- payment records plus an external checkout adapter
- immutable audit events
- portal notifications
- Property Report Tool ingestion endpoint
- migration/backfill tooling
- deployed portal security smoke tests
- role-aware staff permissions

The canonical property record is `properties/{propertyId}`. Portal and operational
features should reference that ID rather than create new property copies.

The application intentionally keeps payment processing provider-neutral. A checkout
provider can be connected through `PAYMENT_CHECKOUT_URL_TEMPLATE` and the
authenticated payment-status webhook without changing Firestore schemas.


## WA tenant statutory form workflows

The Tenant Portal includes guided online workflows for current WA tenancy forms and
bond/PCR processes, while Forms 23 and 22 are intentionally excluded.

Implemented workflows:

- Form 24 — Request to lessor to affix furniture
- Form 25 — Pet request
- Form 26 — Minor modification request
- Form 27 — Request to landlord to make major modification
- Security Bond Release Application
- Variation of Security Bond
- Form 1 — tenant Property Condition Report response
- Form 2 — family-violence termination workflow (restricted)

The server seeds `formDefinitions` from the version-controlled definitions under
`src/tenantForms/formDefinitions.ts`. Each definition stores the official Consumer
Protection source, workflow type, response period where applicable, sensitivity and
the currently recorded official version.

Normal submissions are stored in `tenantFormRequests`. Form 2 is deliberately
stored separately in `sensitiveTenantForms` with evidence under the
`tenant-sensitive/` Storage prefix and a separate `sensitiveAuditEvents`
collection. It is not returned through normal Client Portal or Operations APIs.

Forms 24–27 create Client Portal approval items when the property has an associated
client. A Client Portal approval response updates the corresponding statutory form
record. Response-period expiry is surfaced as a review flag rather than being used
by the software as a final legal determination.

Bond workflows prepare and track the information required for official BondsOnline /
Bonds Administration processing; ProInspect does not replace the official bond
system.

PCR responses require an existing tenant-visible `property_condition_report`
document and store the tenant's structured agreement/disagreement entries plus
supporting attachments.
