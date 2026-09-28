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
FIREBASE_STORAGE_BUCKET=proinspect-client-docs-696236368989-production
ADMIN_EMAILS=info@proinspect.systems,info@remotebusinesspartner.com.au
GOOGLE_CALENDAR_ID=c_4bf5fc54ee54bf60371059cf824ec7e018fb6c43ca66bbdd4051fafaa74e3c32@group.calendar.google.com
```

Cloud Run provides `PORT`; the Docker image defaults to 8080 and the server reads the runtime `PORT` value.

### Infrastructure as Code and Client Portal storage

The `client-portal` branch now contains a Terraform infrastructure layer under `infrastructure/`.

Terraform creates a dedicated private Cloud Storage bucket for Client Portal uploads and generated documents:

`proinspect-client-docs-696236368989-production`

The bucket uses uniform bucket-level access, enforced public-access prevention and object versioning. Terraform grants the Cloud Run runtime service account `roles/storage.objectAdmin` on that bucket.

The infrastructure pipeline also enables required Google APIs, creates Secret Manager containers and grants the runtime identity its Firestore, Firebase Authentication, Service Usage and secret-access permissions.

Run the one-time bootstrap and apply process documented in `infrastructure/README.md`. Do not manually create a second client-document bucket once Terraform is managing this resource.

The application keeps browser Firestore access closed and proxies authenticated file upload/download through the Express server. Client files are limited to 10 MB each and constrained to the file types enforced in `src/server/clientFiles.ts`.

## Infrastructure deployment

Application deployment and infrastructure deployment are intentionally separate.

- the existing Cloud Run / Cloud Build integration continues to build and release the Docker application;
- `cloudbuild.infrastructure.yaml` runs Terraform for supporting infrastructure;
- Terraform remote state is stored in a versioned Google Cloud Storage bucket created by `infrastructure/bootstrap.sh`;
- after Terraform applies, the infrastructure build updates the existing Cloud Run service with Terraform-managed non-secret environment variables and enabled Secret Manager versions.

See `infrastructure/README.md` for bootstrap, plan/apply and production-trigger instructions.

## Continuous deployment

Connect this GitHub repository to Cloud Run / Cloud Build:

- Repository: `info-rbp/ProInspect-Booking-Portal-Application`
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
10. Sign in through `/signin` with a controlled client account.
11. Complete client onboarding and add a controlled property.
12. Upload a small PDF/image through a client request and confirm it can be downloaded again.
13. Submit a document request, generate a draft and confirm the approval appears in the Client Portal and Staff Portal.

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
DOCUMENT_REQUEST_NOTIFY_TO=info@proinspect.systems
```

The public document catalogue uses the same Resend credentials for the customer confirmation and the internal ProInspect notification.

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
