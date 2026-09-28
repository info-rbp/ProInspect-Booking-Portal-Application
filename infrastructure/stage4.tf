# Production release authorization is separate from the staging-only workflow.
variable "operations_bucket_names" {
  type        = map(string)
  default     = {}
  description = "Reviewed existing production bucket names; preserve their state ownership."
  validation {
    condition     = alltrue([for k in keys(var.operations_bucket_names) : contains(["release-evidence", "migration-backups", "build-sources"], k)])
    error_message = "Unknown operations bucket purpose."
  }
}
variable "artifact_repository_id" {
  type        = string
  default     = ""
  description = "Reviewed existing Artifact Registry repository ID, or the environment default."
}
resource "google_secret_manager_secret" "production_release_token" {
  count     = var.environment == "production" ? 1 : 0
  project   = var.project_id
  secret_id = "proinspect-production-release-token"
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}
resource "google_secret_manager_secret_iam_member" "production_release_token" {
  count     = var.environment == "production" ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.production_release_token[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_service_account_email}"
}
resource "google_service_account_iam_member" "production_federation" {
  count              = var.environment == "production" && var.enable_github_federation ? 1 : 0
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.terraform_service_account_email}"
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository_id/${var.github_repository_id}"
}
resource "google_service_account_iam_member" "production_self" {
  count              = var.environment == "production" ? 1 : 0
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.terraform_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.terraform_service_account_email}"
}
resource "google_service_account_iam_member" "production_platform" {
  for_each           = var.environment == "production" ? google_service_account.platform : {}
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.terraform_service_account_email}"
}
resource "google_service_account_iam_member" "production_runtime" {
  count              = var.environment == "production" ? 1 : 0
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.terraform_service_account_email}"
}
