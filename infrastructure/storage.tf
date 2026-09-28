resource "google_storage_bucket" "client_documents" {
  name                        = local.client_documents_bucket_name
  project                     = var.project_id
  location                    = var.storage_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  labels = {
    application = "proinspect"
    environment = var.environment
    purpose     = "client-documents"
    managed-by  = "terraform"
  }

  depends_on = [
    google_project_service.required["storage.googleapis.com"],
  ]
}

resource "google_storage_bucket_iam_member" "runtime_client_document_access" {
  bucket = google_storage_bucket.client_documents.name
  role   = "roles/storage.objectAdmin"
  member = format("serviceAccount:%s", var.runtime_service_account_email)
}
