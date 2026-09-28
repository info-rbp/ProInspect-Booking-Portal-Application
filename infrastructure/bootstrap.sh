#!/usr/bin/env bash
# Run once with an explicitly authorised bootstrap identity. No runtime service changes.
set -euo pipefail
if [[ $# != 4 ]]; then echo 'Usage: bash infrastructure/bootstrap.sh staging|production PROJECT_ID STATE_BUCKET REGION' >&2; exit 2; fi
environment=$1; project=$2; bucket=$3; region=$4
[[ "$environment" == staging || "$environment" == production ]] || exit 2
[[ "$project" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ && "$bucket" =~ ^[a-z0-9][a-z0-9.-]+$ ]] || exit 2
if [[ "$environment" == staging && "$project" == business-plan-applicatio-17047 ]]; then echo 'Staging cannot target production.' >&2; exit 1; fi
if [[ "$environment" == production ]]; then echo 'Stage 3 bootstrap is staging-only. Existing production state must be inventoried/imported, not bootstrapped.' >&2; exit 1; fi
number=$(gcloud projects describe "$project" --format='value(projectNumber)')
[[ -n "$number" ]] || exit 1
gcloud services enable serviceusage.googleapis.com storage.googleapis.com firestore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com secretmanager.googleapis.com firebaserules.googleapis.com identitytoolkit.googleapis.com firebase.googleapis.com sts.googleapis.com logging.googleapis.com calendar-json.googleapis.com sheets.googleapis.com --project="$project"
gcloud beta services identity create --service=firestore.googleapis.com --project="$project"
# Successful list is mandatory: permission errors must never be treated as absence.
existing=$(gcloud storage buckets list --project="$project" --filter="name=$bucket" --format='value(name)')
if [[ -z "$existing" ]]; then
  gcloud storage buckets create "gs://$bucket" --project="$project" --location="$region" --uniform-bucket-level-access --public-access-prevention
fi
owner=$(gcloud storage buckets describe "gs://$bucket" --raw --format='value(projectNumber)')
[[ "$owner" == "$number" ]] || { echo 'State bucket belongs to a different project.' >&2; exit 1; }
gcloud storage buckets update "gs://$bucket" --versioning --uniform-bucket-level-access --public-access-prevention
printf 'State ready: bucket=%s prefix=booking-portal/%s\n' "$bucket" "$environment"
echo 'Use a dedicated backend config, then inventory, import and review the saved Terraform plan. No terraform apply was performed.'
