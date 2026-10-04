# Google Cloud Run deployment

The production hosting target is Google Cloud Run. The existing React/Vite frontend and Express backend run together in the repository Docker image.

## Production configuration

- Google Cloud project: `business-plan-applicatio-17047`
- Cloud Run service: `proinspect-booking-portal-application`
- Region: `europe-west1`
- Runtime service account: `proinspect-booking-runtime@business-plan-applicatio-17047.iam.gserviceaccount.com`
- Public access: enabled
- Minimum instances: 0
- Maximum instances: 3
- Container port: 8080

## Runtime identity

Production uses the Cloud Run runtime service account through Google Application Default Credentials (ADC).

Do not configure these variables in Cloud Run:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON
GOOGLE_APPLICATION_CREDENTIALS
```

The application already falls back to ADC when the optional local-development JSON variables are absent.

The runtime service account must have the required Firestore/Firebase IAM access and must be shared onto the production Google Calendar with permission to modify events.

## Runtime environment variables

Configure these on the Cloud Run service:

```text
FIREBASE_PROJECT_ID=business-plan-applicatio-17047
FIRESTORE_DATABASE_ID=ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a
ADMIN_EMAILS=info@proinspect.systems,info@remotebusinesspartner.com.au
GOOGLE_CALENDAR_ID=c_4bf5fc54ee54bf60371059cf824ec7e018fb6c43ca66bbdd4051fafaa74e3c32@group.calendar.google.com
```

Cloud Run provides `PORT`; the Docker image defaults to 8080 and the server reads the runtime `PORT` value.

## Continuous deployment

Connect this GitHub repository to Cloud Run / Cloud Build:

- Repository: `info-rbp/ProInspect-Platform`
- Production branch regex: `^main$`
- Build type: Dockerfile
- Dockerfile: `/Dockerfile`
- Build context: repository root

Do not add a second GitHub Actions production deployment workflow. Google Cloud Build should own production deployment after the repository is connected.

## Validation before deployment

GitHub Actions verifies:

```bash
npm ci
npm run lint
npm run build
docker build -t proinspect-booking-portal:verify .
```

## First production checks

After Cloud Run creates the service, test the generated `run.app` URL before configuring a production hostname.

1. Open `/api/health`.
2. Confirm the public service catalogue loads.
3. Add the exact `run.app` hostname to Firebase Authentication authorised domains.
4. Sign in to the Staff Portal.
5. Verify service administration loads from Firestore.
6. Check appointment availability.
7. Create one controlled test booking.
8. Confirm the corresponding Google Calendar event is created.
9. Cancel the test booking and confirm the Calendar event is removed.

Do not change production DNS until these tests pass.

## Production hostname

The intended public hostname is `bookings.proinspect.systems`.

Configure the custom hostname only after the generated Cloud Run URL is verified. Cloudflare can remain the DNS provider for `proinspect.systems`; the application runtime no longer depends on Cloudflare Workers or Containers.

After the final hostname is active, add `bookings.proinspect.systems` to Firebase Authentication authorised domains.


## Booking reliability configuration

The booking reliability release adds confirmation email delivery, secure
management links, server-side address verification, tenant access readiness
and field-level encryption for sensitive access credentials.

### Additional APIs

Enable these APIs in the production Google Cloud project:

- Places API (New)
- Address Validation API

The server can use the Cloud Run runtime identity through Application Default
Credentials. `GOOGLE_MAPS_API_KEY` is an optional fallback if you prefer an
API key.

After API enablement has been tested, set:

```text
ADDRESS_VALIDATION_MODE=required
```

Use `optional` during rollout so a temporary Google Maps Platform outage does
not block otherwise valid bookings.

### Sensitive access encryption

Create a 32-byte random encryption key and store it in Secret Manager:

```bash
openssl rand -base64 32
```

Expose that secret to Cloud Run as:

```text
ACCESS_DATA_ENCRYPTION_KEY
```

Also set:

```text
ACCESS_DATA_ENCRYPTION_KEY_ID=v1
```

New lockbox codes and security-alarm details are removed from the normal
`bookings` document, encrypted with AES-256-GCM, and stored separately in
`bookingAccessSecrets/{bookingId}`. Authenticated staff responses decrypt and
restore those details only inside the operations portal.

Do not enable or use lockbox/alarm booking paths in production until
`ACCESS_DATA_ENCRYPTION_KEY` is configured.

### Booking confirmation email

Confirmation email uses Resend's HTTPS email API. Create a Resend API key and
verify the ProInspect sending domain, then store the key in Secret Manager and
expose it as:

```text
RESEND_API_KEY
```

Configure:

```text
BOOKING_EMAIL_FROM=ProInspect <bookings@proinspect.systems>
BOOKING_EMAIL_REPLY_TO=info@proinspect.systems
```

Set `APP_URL` to the active public booking origin. Until the custom domain is
live, use the current Cloud Run service URL. After
`bookings.proinspect.systems` is activated, change `APP_URL` to that origin.

The application does not fail a confirmed booking if the email provider is
temporarily unavailable. Delivery status is recorded against the booking and
shown on the confirmation screen.

### Health verification

`GET /api/health` reports non-secret configuration status:

```json
{
  "ok": true,
  "calendarConfigured": true,
  "bookingEmailConfigured": true,
  "sensitiveAccessEncryptionConfigured": true,
  "addressValidationMode": "required",
  "timezone": "Australia/Perth"
}
```

Do not perform the final production booking test until all of the configuration
flags above show the expected values.


## Controlled live booking test

The repository includes a deliberately gated production smoke test:

```bash
npm run test:e2e:booking
```

It will not create anything unless `E2E_ALLOW_LIVE_WRITE=YES` is explicitly set. The test creates one clearly identified real booking and then immediately cancels it.

Required test environment values:

```text
E2E_BASE_URL=https://proinspect-booking-portal-application-696236368989.europe-west1.run.app
E2E_ALLOW_LIVE_WRITE=YES
E2E_STREET_ADDRESS=<controlled test property street address>
E2E_SUBURB=<test property suburb>
E2E_POSTCODE=<test property postcode>
E2E_TEST_EMAIL=<email inbox used to verify confirmation delivery>
E2E_TEST_PHONE=<valid Australian test contact phone>
```

Optional values include `E2E_UNIT`, `E2E_STATE`, `E2E_PROPERTY_TYPE` and `E2E_SERVICE_ID`.

The smoke test verifies, in sequence:

1. Cloud Run health.
2. Firestore-backed service catalogue.
3. Google Calendar availability.
4. Google Calendar event creation.
5. Firestore booking persistence.
6. Secure management-token lookup.
7. Customer cancellation.
8. Google Calendar event deletion.
9. Persisted Firestore cancelled status.

Because this is a live-write test, run it only after the production encryption, email and address-validation configuration is complete. If the script exits after a booking was created but before cancellation, it prints the secure management URL needed for manual cleanup.


## Tenant portal branch deployment requirements

The `tenant-portal` branch adds tenant authentication, tenancy/property records,
tenant requests, document storage and staff-side tenant operations. Keep this branch
out of production until it has been reviewed and intentionally merged.

### Firebase Authentication

Enable **Email/Password** in Firebase Authentication and enable **Email link
(passwordless sign-in)** for tenant access. Keep Google sign-in enabled for staff.

Add every tenant-portal hostname to Firebase Authentication authorised domains,
including the active Cloud Run hostname during testing and the final custom domain.

Tenant access is invitation/provisioning based: staff must first create a property,
tenancy and tenant user in **Staff Portal > Tenant Portal**. A Firebase-authenticated
email receives no tenancy data unless its verified email matches an active
`tenantUsers` record.

### Firebase Storage

The tenant portal stores request attachments and tenancy documents in the Firebase
Storage bucket. Configure:

```text
FIREBASE_STORAGE_BUCKET=business-plan-applicatio-17047.firebasestorage.app
```

The Cloud Run runtime service account needs permission to create, read and delete
objects in that bucket. Grant an appropriate bucket-level Storage role such as
`roles/storage.objectAdmin` to the runtime identity.

Because tenant downloads use short-lived V4 signed URLs, the runtime identity must
also be able to sign blobs. Grant `roles/iam.serviceAccountTokenCreator` on the
runtime service account to the runtime service account itself (or an equivalent
narrow permission that includes `iam.serviceAccounts.signBlob`).

The browser never reads or writes Storage directly. Uploads and download-link
generation pass through the authenticated Express API. Deploy `storage.rules`
with direct client access denied.

### Tenant email notifications

Tenant request receipts and status updates reuse Resend. You may optionally set:

```text
TENANT_EMAIL_FROM=ProInspect <tenants@proinspect.systems>
TENANT_EMAIL_REPLY_TO=info@proinspect.systems
```

When omitted, the tenant portal falls back to `BOOKING_EMAIL_FROM` and
`BOOKING_EMAIL_REPLY_TO`.

### Shared portal Firestore collections

The tenant and future client modules use:

- `clients`
- `clientUsers`
- `clientPropertyLinks`
- `properties`
- `tenancies`
- `tenantUsers`
- `tenantRequests`
- `propertyDocuments`
- `tenantInspections`

`properties` and `propertyDocuments` are deliberately shared canonical records.
Do not create separate client-property or client-document copies when the Client
Portal UI is added. Client access must be resolved through `clientUsers.clientIds`
and active `clientPropertyLinks`, while tenant access continues to resolve through
active tenancies. Document visibility is controlled by the `audiences` array and
the document's linked `clientIds`.

Direct browser access to Firestore remains denied by `firestore.rules`; all
tenant and staff data access is mediated by the Express API and Firebase ID-token
verification.

### Tenant portal production verification

Before exposing the tenant portal publicly:

1. Confirm `/api/health` reports `tenantStorageConfigured: true`.
2. Confirm `tenantPortalEmailConfigured: true` when email notifications are required.
3. Create a controlled property, tenancy and tenant user in the Staff Portal.
4. Send a passwordless tenant sign-in link and sign in using the provisioned email.
5. Confirm the tenant only sees the tenancy linked to that account.
6. Submit a maintenance request with an attachment.
7. Confirm staff can view the request and change its status.
8. Confirm the tenant sees the updated status and receives the notification email.
9. Upload a tenant document from the Staff Portal and confirm the tenant can open it.
10. Create an inspection entry and confirm it appears under Inspections & Access.


### Client Portal compatibility

The branch includes the Firestore relationships and protected API read surface
required for a later Client Portal implementation. Client portal users are
provisioned in `clientUsers`, clients are linked to canonical properties through
`clientPropertyLinks`, and client-visible files are stored once in
`propertyDocuments`.

When a Client Portal frontend is added, use the existing Firebase ID-token model and
the protected `/api/client/*` routes. Do not permit browser-direct Firestore or
Storage access and do not duplicate documents into a separate client collection.


## Unified platform activation

The consolidated portal branch adds operational collections and APIs on top of the
shared client/property model.

### New operational Firestore collections

- `clientRequests`
- `documentProducts`
- `documentRequests`
- `workOrders`
- `contractors`
- `clientApprovals`
- `payments`
- `auditEvents`
- `portalNotifications`

These collections remain server-only. Do not enable browser-direct Firestore
access.

### Property Report Tool integration

Set `REPORT_INGEST_TOKEN` in Cloud Run and configure the same token in the report
generator. Final reports are posted to:

```text
POST /api/integrations/reports
X-Report-Ingest-Token: <secret>
X-Property-Id: <canonical propertyId>
X-Document-Title: <report title>
X-File-Name: <filename.pdf>
X-Document-Category: property_condition_report | inspection_report | property_report
X-Document-Audiences: client,tenant
X-Tenancy-Id: <optional>
X-Booking-Id: <optional>
Content-Type: application/pdf
```

The report is stored in the canonical `propertyDocuments` collection and inherits
the selected portal audiences.

### Payment adapter

Fixed-fee document requests create a `payments` record automatically. If
`PAYMENT_CHECKOUT_URL_TEMPLATE` is configured, the server expands
`{paymentId}`, `{reference}` and `{totalAmount}` and exposes that checkout URL
in the Client Portal.

External payment providers can confirm payment state through:

```text
POST /api/integrations/payments/:paymentId/status
X-Payment-Webhook-Token: <PAYMENT_WEBHOOK_TOKEN>
Content-Type: application/json

{"status":"paid"}
```

No payment provider credentials are stored in Firestore.

### Portal migration

Always run the migration in dry-run mode first:

```bash
npm run migrate:portal:dry
```

Review the counts, take a Firestore backup, then apply intentionally:

```bash
npm run migrate:portal
```

The migration is designed to be repeatable and uses stable IDs for booking-derived
clients, properties and relationships.

### Security smoke test

Against a deployed non-production environment:

```bash
PORTAL_TEST_BASE_URL=https://... \
PORTAL_TEST_TENANT_TOKEN=... \
PORTAL_TEST_CLIENT_TOKEN=... \
PORTAL_TEST_ADMIN_TOKEN=... \
npm run test:e2e:portal-security
```

The test verifies anonymous isolation and, where tokens are supplied, confirms
tenant/client payloads do not leak Storage paths or staff-only notes.

### Firestore indexes

Deploy `firestore.indexes.json` before relying on filtered audit-history queries.
Use your standard Firebase/Google Cloud deployment process; committing the index
file alone does not change production infrastructure.


## WA tenant form workflow deployment

The consolidated portal uses these additional Firestore collections:

- `formDefinitions`
- `tenantFormRequests`
- `sensitiveTenantForms`
- `sensitiveAuditEvents`

and these Storage prefixes:

- `tenant-portal/forms/` for normal supporting material
- `tenant-sensitive/forms/` for restricted Form 2 evidence

Direct browser Firestore and Storage access must remain denied. Files are only
served via authenticated short-lived signed URLs.

### Sensitive-tenancy access

The `sensitive_tenancy` permission is intentionally not assigned to standard
operations roles. `super_admin` receives it via the wildcard permission. If a
dedicated restricted role is introduced later, grant this permission explicitly
only to personnel authorised to handle family-violence information.

Do not add `sensitiveTenantForms`, its payloads or its evidence to the general
Operations queue, client notifications, client approvals, analytics exports or
ordinary audit feeds.

### Official form maintenance

Before production releases that affect statutory forms, verify the current WA
Consumer Protection source links and prescribed form versions against:

```text
https://www.consumerprotection.wa.gov.au/rental-forms-and-notices
```

Prescribed-form content should not be recreated as a modified ProInspect legal form.
The portal collects structured data and workflow evidence; official statutory output
must continue to use the current approved form/template and official bond process.


## Architecture-freeze pre-merge gate

The `tenant-portal` branch is frozen for broad feature development. Before merging
it into `main`, use a staging/integration branch and complete all of the following:

- take a Firestore export/backup;
- run `npm run migrate:portal:dry`;
- resolve duplicate property address keys before any migration apply;
- review bookings reported without reliable client context rather than inferring
  landlord identity from the booking requester;
- deploy the committed Firestore indexes;
- confirm browser Firestore and Storage access remain denied;
- confirm `REPORT_INGEST_TOKEN`, `PAYMENT_WEBHOOK_TOKEN`, Storage signing,
  tenant email-link Authentication and Resend configuration in staging;
- test owner/admin/member/viewer Client Portal roles;
- test read-only and operational Staff Portal roles;
- test a post-tenancy bond-release workflow;
- test Form 2 only with a specifically authorised restricted staff account;
- run `npm run test:e2e:portal-security` with the optional role-specific tokens;
- run the controlled booking smoke test.

Do not use production as the first environment in which the migration or combined
portal architecture is exercised.
