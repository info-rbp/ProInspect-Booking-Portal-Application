# ProInspect Google Cloud infrastructure

This directory defines the supporting Google Cloud infrastructure required by the ProInspect Booking / Client Portal application.

It is intentionally separate from the application image deployment:

- **Terraform** owns supporting infrastructure: APIs, private client-document storage, Secret Manager containers and runtime IAM.
- **Cloud Build application deployment** continues to own the application container / Cloud Run release.
- **cloudbuild.infrastructure.yaml** applies Terraform and then updates the existing Cloud Run service with Terraform-managed environment values and any Secret Manager values that already have an enabled version.

This avoids two independent systems attempting to own the Cloud Run service definition.

## What Terraform creates and manages

The current production configuration manages:

- required Google Cloud APIs;
- a dedicated private Cloud Storage bucket for Client Portal uploads and generated documents;
- uniform bucket-level access;
- public access prevention;
- object versioning;
- runtime Storage Object Admin access scoped to that bucket;
- runtime Firestore access;
- Firebase / Identity Toolkit read access needed by the server-side client authentication checks;
- Service Usage Consumer access for Google API OAuth quota/billing;
- Secret Manager containers for:
  - `ACCESS_DATA_ENCRYPTION_KEY`
  - `RESEND_API_KEY`
  - optional `GOOGLE_MAPS_API_KEY`;
- Secret Manager accessor permissions for the Cloud Run runtime identity.

The production bucket is deliberately **not** the existing Firebase default bucket. Terraform creates:

`proinspect-client-docs-696236368989-production`

This lets the repository own the Client Portal storage resource cleanly without attempting to take over an existing Firebase-managed bucket.

## Why secret values are not in Terraform

Terraform creates Secret Manager **containers**, but secret payloads are not variables in `.tfvars`.

Putting secret values into Terraform variables would normally persist those values in Terraform state. Instead, add versions directly to Secret Manager after the initial apply.

Examples:

```bash
printf '%s' 'YOUR_BASE64_32_BYTE_KEY' | \
  gcloud secrets versions add proinspect-production-access-data-encryption-key \
  --data-file=- \
  --project=business-plan-applicatio-17047

printf '%s' 'YOUR_RESEND_API_KEY' | \
  gcloud secrets versions add proinspect-production-resend-api-key \
  --data-file=- \
  --project=business-plan-applicatio-17047
```

The Maps API key secret is optional because the current server can authenticate to Address Validation / Places with Google Application Default Credentials.

After a secret version exists, rerunning `cloudbuild.infrastructure.yaml` automatically binds that secret to the Cloud Run environment.

## One-time bootstrap

Terraform cannot store its own state in a bucket that does not exist yet, and Cloud Build needs an identity before it can run Terraform. The only bootstrap step is therefore scripted separately.

Run:

```bash
chmod +x infrastructure/bootstrap.sh
./infrastructure/bootstrap.sh business-plan-applicatio-17047
```

The script:

1. enables the minimum APIs required to bootstrap;
2. creates `proinspect-booking-runtime` if it does not already exist;
3. creates `proinspect-terraform` if it does not already exist;
4. creates the versioned Terraform state bucket;
5. grants the Terraform build identity access to its state bucket;
6. grants the Terraform identity the roles required to manage APIs, IAM, Storage, secrets and Cloud Run configuration;
7. permits the Terraform identity to attach the existing runtime service account to Cloud Run.

The state bucket is:

`gs://business-plan-applicatio-17047-proinspect-terraform-state`

## Manual infrastructure apply

After bootstrap:

```bash
gcloud builds submit \
  --project=business-plan-applicatio-17047 \
  --config=cloudbuild.infrastructure.yaml \
  .
```

The Cloud Build pipeline runs:

```text
terraform fmt -check
        ↓
terraform init
        ↓
terraform validate
        ↓
terraform plan
        ↓
terraform apply
        ↓
export Terraform outputs
        ↓
update existing Cloud Run environment
        ↓
bind Secret Manager values that have enabled versions
```

## Automated Cloud Build trigger

For ongoing infrastructure management, create a dedicated Cloud Build trigger for this config.

Recommended configuration:

- repository: `info-rbp/ProInspect-Booking-Portal-Application`
- build config: `cloudbuild.infrastructure.yaml`
- service account:
  `proinspect-terraform@business-plan-applicatio-17047.iam.gserviceaccount.com`
- require approval: **yes** for production infrastructure
- branch: use the production branch only after this work is eventually merged
- file filtering: trigger only for infrastructure-related changes where supported

Using an approval-gated production trigger prevents an ordinary UI commit from immediately changing IAM or storage infrastructure.

## Current production variables

The non-secret production inputs are in:

`environments/production.tfvars`

They include:

- project ID;
- Cloud Run service name and region;
- runtime service account;
- Firestore database ID;
- Google Calendar ID;
- administrator allow-list;
- public application URL;
- email sender/reply-to configuration;
- document request notification address.

## Cloud Run configuration behaviour

Terraform does not attempt to create or import the existing production Cloud Run service. That service predates this infrastructure layer and is already deployed through the current Cloud Run / Cloud Build integration.

After Terraform applies, the infrastructure build updates that existing service with the complete managed non-secret environment configuration using `--env-vars-file`.

It then conditionally binds:

- `ACCESS_DATA_ENCRYPTION_KEY`;
- `RESEND_API_KEY`;
- `GOOGLE_MAPS_API_KEY`;

only when an enabled Secret Manager version exists.

This means the first infrastructure apply can create the secret containers safely before the secret values have been added.

## Google Calendar limitation

Terraform can enable the Google Calendar API, but access to the dedicated ProInspect calendar is controlled by Google Calendar sharing rather than Google Cloud project IAM.

The runtime service account must therefore still be shared onto:

`c_4bf5fc54ee54bf60371059cf824ec7e018fb6c43ca66bbdd4051fafaa74e3c32@group.calendar.google.com`

with permission to create, update and delete events.

That external Calendar ACL is deliberately not represented as a Google Cloud IAM resource.

## Destructive changes

The client-document bucket has:

- `force_destroy = false`;
- object versioning enabled;
- public access prevention enforced.

Terraform will therefore refuse to casually destroy a bucket containing client files.

Always review the Terraform plan before approving production infrastructure changes.
