#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-business-plan-applicatio-17047}"
STATE_BUCKET="${TF_STATE_BUCKET:-${PROJECT_ID}-proinspect-terraform-state}"
STATE_LOCATION="${TF_STATE_LOCATION:-AU}"
TERRAFORM_SA_ID="${TF_SERVICE_ACCOUNT_ID:-proinspect-terraform}"
RUNTIME_SA_ID="${RUNTIME_SERVICE_ACCOUNT_ID:-proinspect-booking-runtime}"

TERRAFORM_SA="${TERRAFORM_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Bootstrapping ProInspect infrastructure in project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}" >/dev/null

gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com cloudbuild.googleapis.com storage.googleapis.com

if ! gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SA_ID}" --display-name="ProInspect Booking Runtime"
fi

if ! gcloud iam service-accounts describe "${TERRAFORM_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${TERRAFORM_SA_ID}" --display-name="ProInspect Terraform"
fi

if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${STATE_BUCKET}" --project="${PROJECT_ID}" --location="${STATE_LOCATION}" --uniform-bucket-level-access --public-access-prevention
fi

gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
gcloud storage buckets add-iam-policy-binding "gs://${STATE_BUCKET}" --member="serviceAccount:${TERRAFORM_SA}" --role="roles/storage.admin" >/dev/null

PROJECT_ROLES=(
  "roles/logging.logWriter"
  "roles/resourcemanager.projectIamAdmin"
  "roles/run.admin"
  "roles/secretmanager.admin"
  "roles/serviceusage.serviceUsageAdmin"
  "roles/storage.admin"
)

for role in "${PROJECT_ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" --member="serviceAccount:${TERRAFORM_SA}" --role="${role}" --quiet >/dev/null
done

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" --member="serviceAccount:${TERRAFORM_SA}" --role="roles/iam.serviceAccountUser" --quiet >/dev/null

# Cloud Build requires the user-specified build identity to be able to act as
# itself when a trigger executes under that identity.
gcloud iam service-accounts add-iam-policy-binding "${TERRAFORM_SA}" --member="serviceAccount:${TERRAFORM_SA}" --role="roles/iam.serviceAccountUser" --quiet >/dev/null

# Give the human running bootstrap permission to create/run a trigger using
# the Terraform build identity where possible.
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
if [[ -n "${ACTIVE_ACCOUNT}" && "${ACTIVE_ACCOUNT}" != *".gserviceaccount.com" ]]; then
  gcloud iam service-accounts add-iam-policy-binding "${TERRAFORM_SA}" --member="user:${ACTIVE_ACCOUNT}" --role="roles/iam.serviceAccountUser" --quiet >/dev/null || true
fi

cat <<EOF

Bootstrap complete.

Terraform state bucket:
  gs://${STATE_BUCKET}

Terraform build service account:
  ${TERRAFORM_SA}

Cloud Run runtime service account:
  ${RUNTIME_SA}

Next:
  gcloud builds submit --config cloudbuild.infrastructure.yaml .

For an automated Cloud Build trigger, configure the trigger to use:
  ${TERRAFORM_SA}

EOF
