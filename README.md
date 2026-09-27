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

## Google AI Studio / Cloud Run configuration

Keep application code in GitHub and configure runtime secrets in Google AI Studio or Google Cloud rather than committing them.

Required server configuration is documented in `.env.example`.

For production scheduling:

1. Enable the Google Calendar API in the Google Cloud project.
2. Create or select a dedicated ProInspect Google Calendar.
3. Set `GOOGLE_CALENDAR_ID` to that calendar ID.
4. Ensure the runtime service account has write access to the calendar. A common approach is to share the dedicated calendar with the service-account email.
5. If Application Default Credentials are not available in the AI Studio runtime, provide `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` through the AI Studio Secrets panel.
6. Ensure the Firebase/Google Cloud runtime identity can access the configured Firestore database.
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
npm install
npm run lint
npm run build
npm run dev
```

The GitHub Actions workflow in `.github/workflows/verify.yml` performs type-check and production-build verification for the hardening branch and pull requests into `main`.

## Google AI Studio sync workflow

Use GitHub as the source of truth for reviewed code changes:

1. Make and review changes in GitHub.
2. Merge the approved pull request into `main`.
3. In the existing Google AI Studio project, use its GitHub integration to pull/synchronise the updated repository.
4. Keep secrets in AI Studio/Google Cloud configuration rather than in GitHub.


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
