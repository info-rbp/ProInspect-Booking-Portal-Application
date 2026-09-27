# Cloudflare deployment

The production hosting target is Cloudflare Workers + Containers. The React/Vite frontend and existing Express/Firebase/Google Calendar backend remain unchanged inside the container.

## Cloudflare project

Create/import a Worker from this GitHub repository and use:

- Production branch: `main`
- Deploy command: `npx wrangler deploy`
- Root directory: repository root
- Workers Paid plan: required for Containers

Cloudflare Workers Builds can build the Dockerfile automatically when `wrangler deploy` runs.

## Runtime Variables

Configure these under **Workers & Pages > proinspect-booking-portal > Settings > Variables and Secrets**:

```text
FIREBASE_PROJECT_ID
FIRESTORE_DATABASE_ID
ADMIN_EMAILS
GOOGLE_CALENDAR_ID
```

The Wrangler configuration has `keep_vars: true`, so dashboard-managed variables are preserved during Git-based deployments.

## Required Secrets

Configure these as **Secret** values, never plaintext variables:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON
```

They are declared in `wrangler.jsonc` as required secrets, so deployment fails instead of publishing a broken production configuration if either is absent.

## Frontend brand asset

`VITE_PROINSPECT_LOGO_URL` is a build-time Vite value. If a production logo URL is required, set it in `containers[0].image_vars` in `wrangler.jsonc` before deployment. It is public configuration and must never contain credentials.

## Health check

The Worker routes requests to one Cloudflare Container instance. The container exposes:

```text
GET /api/health
```

Cloudflare uses this endpoint to determine when the Node application is ready.

## Deployment

Once the GitHub repository is connected to Cloudflare and the variables/secrets above exist:

```bash
npm install
npx wrangler deploy
```

For Git-connected Workers Builds, pushing to `main` is sufficient after the production branch and deploy command have been configured.

## Firebase Authentication authorised domains

Because the administrator login uses Firebase Google Authentication, add the deployed Cloudflare hostname to **Firebase Authentication > Settings > Authorized domains** before testing staff login.

For production, add the final custom hostname (for example `bookings.proinspect.systems`). If the temporary `workers.dev` URL will be used for authentication testing, add that exact hostname as well.

## Custom domain

Initially the Worker can run on its generated `workers.dev` hostname. After verification, attach the intended ProInspect hostname in Cloudflare under **Settings > Domains & Routes**. A suitable production hostname is `bookings.proinspect.systems` if that subdomain is available.

## Architecture

```text
Browser
  |
Cloudflare Worker
  |
ProInspectContainer
  |
Express + React/Vite
  |-- Firebase Authentication
  |-- Firestore
  |-- Google Calendar API
```

Firestore and Google Calendar remain the application systems of record. No application data is stored on the ephemeral container filesystem.
