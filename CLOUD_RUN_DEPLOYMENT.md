# Google Cloud Run deployment

The production hosting target is Google Cloud Run. The existing React/Vite frontend and Express backend run together in the repository Docker image.

## Production configuration

- Google Cloud project: `business-plan-applicatio-17047`
- Cloud Run service: `proinspect-booking-portal`
- Region: `australia-southeast1`
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

Do not change production DNS until these tests pass.

## Production hostname

The intended public hostname is `bookings.proinspect.systems`.

Configure the custom hostname only after the generated Cloud Run URL is verified. Cloudflare can remain the DNS provider for `proinspect.systems`; the application runtime no longer depends on Cloudflare Workers or Containers.

After the final hostname is active, add `bookings.proinspect.systems` to Firebase Authentication authorised domains.
