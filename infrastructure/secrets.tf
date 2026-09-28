resource "google_secret_manager_secret" "runtime" {
  for_each = local.secret_ids

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = {
    application = "proinspect"
    environment = var.environment
    managed-by  = "terraform"
  }

  depends_on = [
    google_project_service.required["secretmanager.googleapis.com"],
  ]
}

# Secret payloads are intentionally not placed in Terraform variables or state.
# Add secret versions after these containers are created.
resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = format("serviceAccount:%s", var.runtime_service_account_email)
}
