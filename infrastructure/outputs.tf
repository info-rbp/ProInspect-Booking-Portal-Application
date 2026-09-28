output "client_documents_bucket_name" {
  description = "Private bucket used by the Client Portal for uploads and generated files."
  value       = google_storage_bucket.client_documents.name
}

output "runtime_service_account_email" {
  value = var.runtime_service_account_email
}

output "access_data_encryption_secret_id" {
  value = google_secret_manager_secret.runtime["access_data_encryption_key"].secret_id
}

output "resend_api_key_secret_id" {
  value = google_secret_manager_secret.runtime["resend_api_key"].secret_id
}

output "google_maps_api_key_secret_id" {
  value = google_secret_manager_secret.runtime["google_maps_api_key"].secret_id
}

output "runtime_environment" {
  description = "Non-secret Cloud Run environment configuration managed by the infrastructure pipeline."
  value       = local.runtime_environment
}

output "required_apis" {
  value = sort(tolist(var.required_apis))
}
