# No production CI deployment permissions are granted in Stage 3.
resource "google_project_iam_member" "staging_deployer" {
  for_each = var.enable_staging_ci ? toset(["roles/run.developer", "roles/run.invoker", "roles/cloudbuild.builds.editor", "roles/serviceusage.serviceUsageConsumer", "roles/artifactregistry.reader"]) : toset([])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.automation["deploy"].email}"
}
resource "google_storage_bucket_iam_member" "staging_source_uploader" {
  count  = var.enable_staging_ci ? 1 : 0
  bucket = google_storage_bucket.operations["build-source"].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.automation["deploy"].email}"
}
resource "google_service_account_iam_member" "staging_act_as_runtime" {
  count              = var.enable_staging_ci ? 1 : 0
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.runtime_service_account_email}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.automation["deploy"].email}"
  depends_on         = [google_service_account.runtime]
}
resource "google_service_account_iam_member" "staging_act_as_build" {
  count              = var.enable_staging_ci ? 1 : 0
  service_account_id = google_service_account.automation["build"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.automation["deploy"].email}"
}
resource "google_iam_workload_identity_pool" "staging" {
  count                     = var.enable_staging_ci ? 1 : 0
  project                   = var.project_id
  workload_identity_pool_id = "proinspect-staging"
  display_name              = "ProInspect staging CI only"
  depends_on                = [google_project_service.required]
}
resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.enable_staging_ci ? 1 : 0
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.staging[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
  }
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_owner_id}' && assertion.ref == 'refs/heads/release/platform-unification' && assertion.sub == 'repo:info-rbp/ProInspect-Booking-Portal-Application:environment:staging' && assertion.workflow_ref == 'info-rbp/ProInspect-Booking-Portal-Application/.github/workflows/stage3-staging.yml@refs/heads/release/platform-unification'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "github_staging" {
  count              = var.enable_staging_ci ? 1 : 0
  service_account_id = google_service_account.automation["deploy"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.staging[0].name}/attribute.repository_id/${var.github_repository_id}"
}
