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

output "platform" {
  value = {
    project_id                 = var.project_id
    production_project_id      = var.production_project_id
    environment                = var.environment
    region                     = var.region
    service_name               = var.cloud_run_service_name
    database_id                = var.firestore_database_id
    runtime_service_account    = var.runtime_service_account_email
    build_service_account      = google_service_account.automation["build"].email
    deploy_service_account     = google_service_account.automation["deploy"].email
    migration_service_account  = google_service_account.automation["migration"].email
    documents_bucket           = google_storage_bucket.client_documents.name
    source_bucket              = google_storage_bucket.operations["build-source"].name
    evidence_bucket            = google_storage_bucket.operations["migration-evidence"].name
    backup_bucket              = google_storage_bucket.operations["firestore-backups"].name
    image_repository           = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.platform.repository_id}/platform"
    workload_identity_provider = try(google_iam_workload_identity_pool_provider.github[0].name, null)
    runtime_environment        = local.runtime_environment
    secret_ids                 = local.secret_ids
    secret_bindings            = { for key, version in var.runtime_secret_versions : local.secret_env_names[key] => "${local.secret_ids[key]}:${version}" }
  }
}
