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
